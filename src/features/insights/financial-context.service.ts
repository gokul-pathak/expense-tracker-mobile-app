import { DEFAULT_CURRENCY } from '@/db/constants';
import { listActiveAccounts } from '@/features/accounts/account.service';
import { redactSensitiveText } from '@/features/ai/expense-suggestion.sanitize';
import { currentPeriodMonth, sortBudgetProgress } from '@/features/budgets/budget-presentation';
import { getMonthlyBudgetSummary, listBudgetsForMonth } from '@/features/budgets/budget.service';
import { periodMonthsInRange } from '@/features/budgets/budget.period';
import type { BudgetProgress } from '@/features/budgets/budget.types';
import { listPeople } from '@/features/people/person.service';
import { localDateOf } from '@/features/recurring/recurring-schedule';
import { DUE_OCCURRENCE_LIMIT, listDueOccurrences } from '@/features/recurring/recurring.service';
import {
  getExpenseCategoryBreakdown,
  getLargestExpenses,
  getReportSummary,
  listReportCurrencies,
} from '@/features/reports/reports.service';
import { getAppSettings } from '@/features/settings/settings.service';
import { getAccountBalance } from '@/features/transactions/account-balance.service';
import { getPeopleFinancialSummaryByCurrency } from '@/features/transactions/transaction.service';
import type { DateRange } from '@/utils/date-range';
import { formatMinorUnits } from '@/utils/money';

import {
  CONTEXT_LIMITS,
  CONTEXT_VERSION,
  type AccountsFact,
  type BudgetFact,
  type BudgetsFact,
  type BuiltFinancialContext,
  type CategorySpendingFact,
  type ContextMoney,
  type ContextPlan,
  type FinancialAssistantContext,
  type HeadlineFact,
  type LargestExpensesFact,
  type LendingFact,
  type RecurringFact,
  type SummaryFact,
  type TrendFact,
} from './financial-context.types';
import {
  isInProgress,
  periodFact,
  periodMonthLabel,
  previousComparablePeriod,
} from './insight-period';

/**
 * The deterministic financial context behind every insight.
 *
 * **Every number here comes from an existing domain service.** Reports answers
 * income, expense, savings, categories and largest expenses; the budget engine
 * answers budget progress; the recurring engine answers what is due; the
 * lending engine answers who owes what; account balances come from the balance
 * service. This module selects, bounds and labels those answers. The only
 * arithmetic it does is between figures those services already returned — a
 * difference between two periods, a sum of due items, a total of per-account
 * balances within one currency — and never on raw transactions.
 *
 * **One currency at a time.** The app never converts, so every section is
 * split by currency, and no figure ever adds two currencies together.
 *
 * **Only what the question needs.** The plan names the sections; nothing else
 * is read into the context. No notes except a short, redacted description on
 * the largest expenses; no account names unless asked; no person names except
 * one the question itself named — a ranking uses `Person 1`, `Person 2`.
 *
 * **One consistent snapshot.** The build is synchronous from the first query to
 * the last. On the app's single JavaScript thread nothing — no save, no sync
 * write — can run in between, so the summary and the categories beside it always
 * describe the same database.
 *
 * Read-only: it imports no function that writes, and a test holds it to that.
 */
export function buildFinancialContext(
  plan: ContextPlan,
  now: Date = new Date(),
): BuiltFinancialContext {
  const notes: string[] = [];
  const headlines: HeadlineFact[] = [];
  const personNames: Record<string, string> = {};
  const defaultCurrency = readDefaultCurrency();
  const { period } = plan;
  const has = (section: ContextPlan['sections'][number]) => plan.sections.includes(section);

  if (plan.periodNote) notes.push(plan.periodNote);

  const context: FinancialAssistantContext = {
    contextVersion: CONTEXT_VERSION,
    snapshotDate: localDateOf(now),
    period: periodFact(period),
    notes,
  };

  const periodSections = has('summary') || has('categories') || has('largestExpenses');
  if (periodSections && isInProgress(period, now)) {
    notes.push(`${period.label} is still in progress; figures run to ${localDateOf(now)}.`);
  }

  if (has('summary') || has('categories')) {
    const currencies = currenciesIn([period.range], defaultCurrency, notes);
    const summary = currencies.map((currency) => summaryFor(period.range, currency));
    if (has('summary')) {
      context.summary = summary;
      summary.forEach((fact, index) => {
        headlines.push({ label: 'Expense', minor: fact.expense.minor, currency: fact.currency });
        if (index === 0) {
          headlines.push({ label: 'Income', minor: fact.income.minor, currency: fact.currency });
          headlines.push({ label: 'Savings', minor: fact.savings.minor, currency: fact.currency });
        }
      });
    }
    if (has('categories')) {
      context.categories = summary.map((fact) => categoriesFor(period.range, fact));
      const top = context.categories.find((fact) => fact.top.length > 0);
      if (top?.top[0] !== undefined) {
        headlines.push({
          label: `Top category: ${top.top[0].category}`,
          minor: top.top[0].amount.minor,
          currency: top.currency,
        });
      }
    }
  }

  if (has('largestExpenses')) {
    const currencies = currenciesIn([period.range], defaultCurrency, notes);
    context.largestExpenses = currencies
      .map((currency) => largestFor(period.range, currency))
      .filter((fact) => fact.items.length > 0);
    const first = context.largestExpenses[0];
    if (first?.items[0] !== undefined) {
      headlines.push({
        label: 'Largest expense',
        minor: first.items[0].amount.minor,
        currency: first.currency,
      });
    }
  }

  if (has('trend')) {
    context.trend = trendFor(plan, defaultCurrency, notes, now);
    const first = context.trend.byCurrency[0];
    if (first !== undefined) {
      headlines.push(
        { label: 'Expense', minor: first.currentExpense.minor, currency: first.currency },
        {
          label: `Expense, ${context.trend.previousPeriod.label}`,
          minor: first.previousExpense.minor,
          currency: first.currency,
        },
        { label: 'Difference', minor: first.expenseDifference.minor, currency: first.currency },
      );
    }
  }

  if (has('budgets')) {
    context.budgets = budgetsFor(plan, notes, now);
    for (const group of context.budgets.byCurrency) {
      const over = [group.overall, ...group.categories].find(
        (fact): fact is BudgetFact => fact?.status === 'over_budget',
      );
      if (over !== undefined) {
        headlines.push({
          label: `${over.name}, over by`,
          minor: over.overspent.minor,
          currency: group.currency,
        });
      }
      headlines.push({ label: 'Spent', minor: group.totalSpent.minor, currency: group.currency });
    }
  }

  if (has('accounts')) {
    context.accounts = accountsFor(plan, notes);
    for (const group of context.accounts.byCurrency) {
      headlines.push({
        label: 'Total balance',
        minor: group.totalBalance.minor,
        currency: group.currency,
      });
    }
  }

  if (has('lending')) {
    context.lending = lendingFor(plan, notes, personNames);
    for (const group of context.lending.byCurrency) {
      headlines.push(
        { label: 'Owed to you', minor: group.totalReceivable.minor, currency: group.currency },
        { label: 'You owe', minor: group.totalLiability.minor, currency: group.currency },
      );
    }
  }

  if (has('recurring')) {
    context.recurring = recurringFor(notes, now);
    for (const total of context.recurring.totals) {
      headlines.push({
        label: total.type === 'expense' ? 'Due expenses' : 'Due income',
        minor: total.total.minor,
        currency: total.currency,
      });
    }
  }

  context.notes = notes
    .slice(0, CONTEXT_LIMITS.notes)
    .map((note) => clip(note, CONTEXT_LIMITS.noteMax));
  return { context, headlines: headlines.slice(0, 4), personNames };
}

// Sections --------------------------------------------------------------------

function summaryFor(range: DateRange, currency: string): SummaryFact {
  const summary = getReportSummary(range, { currency });
  return {
    currency,
    income: money(summary.incomeMinor, currency),
    expense: money(summary.expenseMinor, currency),
    savings: money(summary.savingsMinor, currency),
  };
}

function categoriesFor(range: DateRange, summary: SummaryFact): CategorySpendingFact {
  const { currency } = summary;
  const breakdown = getExpenseCategoryBreakdown(range, { currency });
  const shown = breakdown.slice(0, CONTEXT_LIMITS.topCategories);
  const rest = breakdown.slice(CONTEXT_LIMITS.topCategories);
  const listedMinor = breakdown.reduce((total, item) => total + item.amountMinor, 0);
  const unlistedMinor = summary.expense.minor - listedMinor;
  return {
    currency,
    totalExpense: summary.expense,
    top: shown.map((item) => ({
      category: label(item.categoryName, CONTEXT_LIMITS.nameMax, 'Unnamed category'),
      amount: money(item.amountMinor, currency),
      sharePercent: Math.round(item.percentage),
    })),
    otherCategories:
      rest.length === 0
        ? null
        : {
            count: rest.length,
            amount: money(
              rest.reduce((total, item) => total + item.amountMinor, 0),
              currency,
            ),
          },
    unlisted: unlistedMinor > 0 ? money(unlistedMinor, currency) : null,
  };
}

function largestFor(range: DateRange, currency: string): LargestExpensesFact {
  return {
    currency,
    items: getLargestExpenses(range, {
      limit: CONTEXT_LIMITS.largestExpenses,
      filters: { currency },
    }).map((item) => ({
      date: localDateOf(item.transactionDate),
      category:
        item.categoryName === null ? null : label(item.categoryName, CONTEXT_LIMITS.nameMax),
      amount: money(item.amountMinor, currency),
      description: optionalLabel(item.note ?? item.title, CONTEXT_LIMITS.descriptionMax),
    })),
  };
}

function trendFor(
  plan: ContextPlan,
  defaultCurrency: string,
  notes: string[],
  now: Date,
): TrendFact {
  const current = plan.period;
  const previous = previousComparablePeriod(current);
  const currencies = currenciesIn([current.range, previous.range], defaultCurrency, notes);

  if (isInProgress(current, now)) {
    notes.push(
      `${current.label} is still in progress and is compared with all of ${previous.label}.`,
    );
  }

  const byCurrency = currencies.map((currency) => {
    const now_ = getReportSummary(current.range, { currency });
    const before = getReportSummary(previous.range, { currency });
    const expenseDifference = now_.expenseMinor - before.expenseMinor;
    if (before.expenseMinor === 0) {
      notes.push(
        `No ${currency} expenses were recorded in ${previous.label}, so there is no percentage change.`,
      );
    }

    const currentCategories = getExpenseCategoryBreakdown(current.range, { currency });
    const previousCategories = getExpenseCategoryBreakdown(previous.range, { currency });
    const byCategory = new Map<number, { name: string; current: number; previous: number }>();
    for (const item of currentCategories) {
      byCategory.set(item.categoryId, {
        name: item.categoryName,
        current: item.amountMinor,
        previous: 0,
      });
    }
    for (const item of previousCategories) {
      const entry = byCategory.get(item.categoryId);
      if (entry === undefined) {
        byCategory.set(item.categoryId, {
          name: item.categoryName,
          current: 0,
          previous: item.amountMinor,
        });
      } else {
        entry.previous = item.amountMinor;
      }
    }
    const categoryChanges = [...byCategory.entries()]
      .map(([id, entry]) => ({ id, ...entry, difference: entry.current - entry.previous }))
      .filter((entry) => entry.difference !== 0)
      .sort(
        (left, right) =>
          Math.abs(right.difference) - Math.abs(left.difference) || left.id - right.id,
      )
      .slice(0, CONTEXT_LIMITS.categoryChanges)
      .map((entry) => ({
        category: label(entry.name, CONTEXT_LIMITS.nameMax, 'Unnamed category'),
        current: money(entry.current, currency),
        previous: money(entry.previous, currency),
        difference: money(entry.difference, currency),
      }));

    return {
      currency,
      currentExpense: money(now_.expenseMinor, currency),
      previousExpense: money(before.expenseMinor, currency),
      expenseDifference: money(expenseDifference, currency),
      expensePercentChange:
        before.expenseMinor === 0
          ? null
          : Math.round((expenseDifference * 1000) / before.expenseMinor) / 10,
      currentIncome: money(now_.incomeMinor, currency),
      previousIncome: money(before.incomeMinor, currency),
      incomeDifference: money(now_.incomeMinor - before.incomeMinor, currency),
      categoryChanges,
    };
  });

  return { previousPeriod: periodFact(previous), byCurrency };
}

function budgetsFor(plan: ContextPlan, notes: string[], now: Date): BudgetsFact {
  const months = periodMonthsInRange(plan.period.range);
  const month = months !== null && months.length === 1 ? months[0]! : currentPeriodMonth(now);
  const monthLabel = periodMonthLabel(month);
  if (months === null || months.length !== 1) {
    notes.push(`Budgets are monthly, so this uses ${monthLabel}.`);
  }

  const currencies = orderCurrencies(
    [...new Set(listBudgetsForMonth(month).map((budget) => budget.currency))],
    readDefaultCurrency(),
  ).slice(0, CONTEXT_LIMITS.currencies);
  if (currencies.length === 0) notes.push(`No budgets are set for ${monthLabel}.`);

  const byCurrency = currencies.map((currency) => {
    const summary = getMonthlyBudgetSummary(month, currency);
    const sorted = sortBudgetProgress(summary.categoryBudgets);
    const everything = [summary.overallBudget, ...summary.categoryBudgets].filter(
      (progress): progress is BudgetProgress => progress !== null,
    );
    if (summary.overallBudget !== null && summary.categoryBudgets.length > 0) {
      notes.push('An overall budget already covers category spending; the two are never added.');
    }
    return {
      currency,
      totalBudgeted:
        summary.totalBudgetedMinor === null ? null : money(summary.totalBudgetedMinor, currency),
      totalSpent: money(summary.totalSpentMinor, currency),
      overall: summary.overallBudget === null ? null : budgetFact(summary.overallBudget),
      categories: sorted.slice(0, CONTEXT_LIMITS.budgetCategories).map(budgetFact),
      overBudgetCount: everything.filter((progress) => progress.status === 'over_budget').length,
      omittedCount: Math.max(0, sorted.length - CONTEXT_LIMITS.budgetCategories),
    };
  });

  return { month, monthLabel, byCurrency };
}

function accountsFor(plan: ContextPlan, notes: string[]): AccountsFact {
  const mention = plan.mentionText ?? '';
  const groups = new Map<string, { name: string; balance: number }[]>();
  for (const account of listActiveAccounts()) {
    const list = groups.get(account.currency) ?? [];
    list.push({ name: account.name, balance: getAccountBalance(account.id) });
    groups.set(account.currency, list);
  }
  notes.push('Balances are for active accounts and do not include money owed to or by people.');

  const byCurrency = orderCurrencies([...groups.keys()], readDefaultCurrency())
    .slice(0, CONTEXT_LIMITS.currencies)
    .map((currency) => {
      const list = groups.get(currency) ?? [];
      const named =
        plan.accounts === 'named' ? list : list.filter((item) => mentions(mention, item.name));
      return {
        currency,
        totalBalance: money(
          list.reduce((total, item) => total + item.balance, 0),
          currency,
        ),
        accountCount: list.length,
        accounts:
          named.length === 0
            ? null
            : [...named]
                .sort((left, right) => right.balance - left.balance)
                .slice(0, CONTEXT_LIMITS.accounts)
                .map((item) => ({
                  name: label(item.name, CONTEXT_LIMITS.nameMax, 'Unnamed account'),
                  balance: money(item.balance, currency),
                })),
      };
    });
  return { byCurrency };
}

function lendingFor(
  plan: ContextPlan,
  notes: string[],
  personNames: Record<string, string>,
): LendingFact {
  const mention = plan.mentionText ?? '';
  const names = new Map(listPeople().map((person) => [person.id, person.name]));
  notes.push(
    'Money owed to you and money you owe are current totals. They are not income or expenses, and not part of Total Balance.',
  );
  let alias = 0;

  const groups = getPeopleFinancialSummaryByCurrency();
  const byCurrency = orderCurrencies(
    groups.map((group) => group.currency),
    readDefaultCurrency(),
  )
    .slice(0, CONTEXT_LIMITS.currencies)
    .map((currency) => {
      const group = groups.find((item) => item.currency === currency)!;
      const withBalance = group.people.filter(
        (person) => person.receivableMinor !== 0 || person.liabilityMinor !== 0,
      );

      let people: LendingFact['byCurrency'][number]['people'] = null;
      if (plan.people === 'ranking') {
        people = withBalance.slice(0, CONTEXT_LIMITS.people).map((person) => {
          alias += 1;
          const key = `Person ${alias}`;
          personNames[key] = names.get(person.personId) ?? key;
          return {
            label: key,
            receivable: money(person.receivableMinor, currency),
            liability: money(person.liabilityMinor, currency),
          };
        });
      } else if (plan.people === 'mentioned') {
        const named = group.people.filter((person) => {
          const name = names.get(person.personId);
          return name !== undefined && mentions(mention, name);
        });
        people =
          named.length === 0
            ? null
            : named.slice(0, CONTEXT_LIMITS.people).map((person) => ({
                label: label(names.get(person.personId) ?? '', CONTEXT_LIMITS.nameMax, 'Unnamed'),
                receivable: money(person.receivableMinor, currency),
                liability: money(person.liabilityMinor, currency),
              }));
      }

      return {
        currency,
        totalReceivable: money(group.totalReceivableMinor, currency),
        totalLiability: money(group.totalLiabilityMinor, currency),
        peopleWithBalance: withBalance.length,
        people,
      };
    });
  return { byCurrency };
}

function recurringFor(notes: string[], now: Date): RecurringFact {
  const asOfDate = localDateOf(now);
  const due = listDueOccurrences({ asOfDate, limit: DUE_OCCURRENCE_LIMIT });
  notes.push(
    `Due recurring transactions are as of ${asOfDate}. They are not income or expenses until they are generated.`,
  );
  if (due.hasMore) {
    notes.push(
      `More than ${due.occurrences.length} are due; counts and totals cover the first ${due.occurrences.length}.`,
    );
  }

  const totals = new Map<string, RecurringFact['totals'][number]>();
  for (const occurrence of due.occurrences) {
    const key = `${occurrence.type}:${occurrence.currency}`;
    const entry = totals.get(key);
    const sum = (entry?.total.minor ?? 0) + occurrence.amountMinor;
    totals.set(key, {
      type: occurrence.type,
      currency: occurrence.currency,
      count: (entry?.count ?? 0) + 1,
      total: money(sum, occurrence.currency),
    });
  }

  return {
    asOfDate,
    dueCount: due.occurrences.length,
    moreDue: due.hasMore,
    totals: [...totals.values()].sort(
      (left, right) =>
        left.type.localeCompare(right.type) || left.currency.localeCompare(right.currency),
    ),
    items: due.occurrences.slice(0, CONTEXT_LIMITS.recurringItems).map((occurrence) => ({
      date: occurrence.occurrenceDate,
      type: occurrence.type,
      category:
        occurrence.categoryName === null
          ? null
          : label(occurrence.categoryName, CONTEXT_LIMITS.nameMax),
      amount: money(occurrence.amountMinor, occurrence.currency),
    })),
  };
}

// Helpers ---------------------------------------------------------------------

function currenciesIn(ranges: DateRange[], defaultCurrency: string, notes: string[]): string[] {
  const found = new Set(ranges.flatMap((range) => listReportCurrencies(range)));
  const ordered = orderCurrencies(
    found.size === 0 ? [defaultCurrency] : [...found],
    defaultCurrency,
  );
  const note = 'Amounts in different currencies are listed separately and never added together.';
  if (ordered.length > 1 && !notes.includes(note)) notes.push(note);
  return ordered.slice(0, CONTEXT_LIMITS.currencies);
}

/** The app's default currency first, then alphabetical. */
function orderCurrencies(currencies: string[], defaultCurrency: string): string[] {
  return [...new Set(currencies)].sort((left, right) => {
    if (left === defaultCurrency) return -1;
    if (right === defaultCurrency) return 1;
    return left.localeCompare(right);
  });
}

function budgetFact(progress: BudgetProgress): BudgetFact {
  const { currency } = progress.budget;
  return {
    name:
      progress.budget.categoryId === null
        ? 'Overall monthly budget'
        : label(progress.categoryName ?? '', CONTEXT_LIMITS.nameMax, 'Deleted category'),
    budgeted: money(progress.budget.amountMinor, currency),
    spent: money(progress.spentMinor, currency),
    remaining: money(progress.remainingMinor, currency),
    overspent: money(progress.overspentMinor, currency),
    percentUsed: Number.isFinite(progress.percentage) ? Math.round(progress.percentage) : 0,
    status: progress.status,
  };
}

function money(minor: number, currency: string): ContextMoney {
  return { minor, display: formatMinorUnits(minor, currency) };
}

/** A name as data: redacted, plain, and short. */
function label(value: string, max: number, fallback = 'Unnamed'): string {
  return optionalLabel(value, max) ?? fallback;
}

function optionalLabel(value: string | null, max: number): string | null {
  if (value === null) return null;
  const text = clip(redactSensitiveText(value), max);
  return text === '' ? null : text;
}

function clip(text: string, max: number): string {
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  const space = cut.lastIndexOf(' ');
  return (space > max / 2 ? cut.slice(0, space) : cut).trim();
}

/** Whether the question names this person or account as a whole word. */
function mentions(text: string, name: string): boolean {
  const needle = name.normalize('NFKC').toLowerCase().trim();
  if (needle.length < 3 || text === '') return false;
  const escaped = needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(?:^|[^\\p{L}\\p{N}])${escaped}(?:$|[^\\p{L}\\p{N}])`, 'u').test(text);
}

function readDefaultCurrency(): string {
  try {
    return getAppSettings().defaultCurrency;
  } catch {
    return DEFAULT_CURRENCY;
  }
}
