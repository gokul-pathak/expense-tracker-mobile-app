import { isPlainObject } from '../expense-suggestion/request-validation.ts';
import { cleanText, hasMarkupOrLink, hasUnredactedIdentifier } from '../expense-suggestion/text.ts';

import {
  CONTEXT_LIMITS,
  CONTEXT_SECTIONS,
  CONTEXT_VERSION,
  INSIGHT_CONTRACT_VERSION,
  INSIGHT_INTENTS,
  INSIGHT_LIMITS,
  PERIOD_KINDS,
  SECTIONS_FOR_INTENT,
  type InsightIntent,
  type InsightRequest,
  type ValidatedContext,
} from './contract.ts';

/**
 * Everything a financial-insight request may carry, checked before a provider
 * is called.
 *
 * The context comes from the app, so it is untrusted input like any other: a
 * modified client, a bug, or a replayed request could send anything. So every
 * object must have exactly its fields, every array stays within its bound,
 * every amount is a safe integer whose display string spells the same number in
 * the same currency, and the figures that are defined in terms of each other —
 * savings, differences, budget remainders — must actually agree. A section the
 * question's intent does not use is refused outright, so a spending question
 * cannot smuggle balances or names along with it.
 *
 * The server does not claim the figures are right. The app's database is the
 * source of truth; this only makes sure the request is the shape the app would
 * send, and no bigger.
 */

export type InsightRequestValidation = { ok: true; request: InsightRequest } | { ok: false };

class Refused extends Error {}

function refuse(): never {
  throw new Refused();
}

export function validateInsightRequest(body: unknown): InsightRequestValidation {
  try {
    return { ok: true, request: requestOf(body) };
  } catch {
    return { ok: false };
  }
}

function requestOf(body: unknown): InsightRequest {
  const value = shape(body, ['context', 'intent', 'question', 'version']);
  if (value.version !== INSIGHT_CONTRACT_VERSION) refuse();
  const intent = oneOf(value.intent, INSIGHT_INTENTS);
  return {
    version: INSIGHT_CONTRACT_VERSION,
    intent,
    question: text(value.question, INSIGHT_LIMITS.questionMax),
    context: contextOf(value.context, intent),
  };
}

function contextOf(value: unknown, intent: InsightIntent): ValidatedContext {
  const context = shape(
    value,
    ['contextVersion', 'notes', 'period', 'snapshotDate'],
    CONTEXT_SECTIONS,
  );
  if (context.contextVersion !== CONTEXT_VERSION) refuse();

  const allowed = SECTIONS_FOR_INTENT[intent];
  const present = CONTEXT_SECTIONS.filter((section) => section in context);
  if (present.length === 0 || present.some((section) => !allowed.includes(section))) refuse();

  const result: ValidatedContext = {
    contextVersion: CONTEXT_VERSION,
    snapshotDate: date(context.snapshotDate),
    period: periodOf(context.period),
    notes: list(context.notes, CONTEXT_LIMITS.notes, (note) => text(note, CONTEXT_LIMITS.noteMax)),
  };
  if ('summary' in context)
    result.summary = list(context.summary, CONTEXT_LIMITS.currencies, summaryOf);
  if ('categories' in context) {
    result.categories = list(context.categories, CONTEXT_LIMITS.currencies, categoriesOf);
  }
  if ('largestExpenses' in context) {
    result.largestExpenses = list(context.largestExpenses, CONTEXT_LIMITS.currencies, largestOf);
  }
  if ('trend' in context) result.trend = trendOf(context.trend);
  if ('budgets' in context) result.budgets = budgetsOf(context.budgets);
  if ('accounts' in context) result.accounts = accountsOf(context.accounts);
  if ('lending' in context) result.lending = lendingOf(context.lending);
  if ('recurring' in context) result.recurring = recurringOf(context.recurring);
  return result;
}

// Sections --------------------------------------------------------------------

function periodOf(value: unknown) {
  const period = shape(value, ['end', 'kind', 'label', 'start']);
  const start = date(period.start);
  const end = date(period.end);
  if (start > end) refuse();
  return {
    kind: oneOf(period.kind, PERIOD_KINDS),
    label: text(period.label, CONTEXT_LIMITS.labelMax),
    start,
    end,
  };
}

function summaryOf(value: unknown) {
  const fact = shape(value, ['currency', 'expense', 'income', 'savings']);
  const currency = currencyOf(fact.currency);
  const income = money(fact.income, currency);
  const expense = money(fact.expense, currency);
  const savings = money(fact.savings, currency);
  if (savings.minor !== income.minor - expense.minor) refuse();
  return { currency, income, expense, savings };
}

function categoriesOf(value: unknown) {
  const fact = shape(value, ['currency', 'otherCategories', 'top', 'totalExpense', 'unlisted']);
  const currency = currencyOf(fact.currency);
  return {
    currency,
    totalExpense: money(fact.totalExpense, currency),
    top: list(fact.top, CONTEXT_LIMITS.topCategories, (item) => {
      const entry = shape(item, ['amount', 'category', 'sharePercent']);
      return {
        category: text(entry.category, CONTEXT_LIMITS.nameMax),
        amount: money(entry.amount, currency),
        sharePercent: integer(entry.sharePercent, 0, 100),
      };
    }),
    otherCategories: nullable(fact.otherCategories, (other) => {
      const entry = shape(other, ['amount', 'count']);
      return { count: integer(entry.count, 1, 100_000), amount: money(entry.amount, currency) };
    }),
    unlisted: nullable(fact.unlisted, (amount) => money(amount, currency)),
  };
}

function largestOf(value: unknown) {
  const fact = shape(value, ['currency', 'items']);
  const currency = currencyOf(fact.currency);
  return {
    currency,
    items: list(fact.items, CONTEXT_LIMITS.largestExpenses, (item) => {
      const entry = shape(item, ['amount', 'category', 'date', 'description']);
      return {
        date: date(entry.date),
        category: nullable(entry.category, (name) => text(name, CONTEXT_LIMITS.nameMax)),
        amount: money(entry.amount, currency),
        description: nullable(entry.description, (description) =>
          text(description, CONTEXT_LIMITS.descriptionMax),
        ),
      };
    }),
  };
}

function trendOf(value: unknown) {
  const trend = shape(value, ['byCurrency', 'previousPeriod']);
  return {
    previousPeriod: periodOf(trend.previousPeriod),
    byCurrency: list(trend.byCurrency, CONTEXT_LIMITS.currencies, (item) => {
      const fact = shape(item, [
        'categoryChanges',
        'currency',
        'currentExpense',
        'currentIncome',
        'expenseDifference',
        'expensePercentChange',
        'incomeDifference',
        'previousExpense',
        'previousIncome',
      ]);
      const currency = currencyOf(fact.currency);
      const currentExpense = money(fact.currentExpense, currency);
      const previousExpense = money(fact.previousExpense, currency);
      const expenseDifference = money(fact.expenseDifference, currency);
      const currentIncome = money(fact.currentIncome, currency);
      const previousIncome = money(fact.previousIncome, currency);
      const incomeDifference = money(fact.incomeDifference, currency);
      if (expenseDifference.minor !== currentExpense.minor - previousExpense.minor) refuse();
      if (incomeDifference.minor !== currentIncome.minor - previousIncome.minor) refuse();
      const expensePercentChange = nullable(fact.expensePercentChange, (percent) =>
        finite(percent, -10_000_000, 10_000_000),
      );
      // No previous amount, no percentage: never an Infinity dressed as a number.
      if ((previousExpense.minor === 0) !== (expensePercentChange === null)) refuse();
      return {
        currency,
        currentExpense,
        previousExpense,
        expenseDifference,
        expensePercentChange,
        currentIncome,
        previousIncome,
        incomeDifference,
        categoryChanges: list(fact.categoryChanges, CONTEXT_LIMITS.categoryChanges, (change) => {
          const entry = shape(change, ['category', 'current', 'difference', 'previous']);
          const current = money(entry.current, currency);
          const previous = money(entry.previous, currency);
          const difference = money(entry.difference, currency);
          if (difference.minor !== current.minor - previous.minor) refuse();
          return {
            category: text(entry.category, CONTEXT_LIMITS.nameMax),
            current,
            previous,
            difference,
          };
        }),
      };
    }),
  };
}

const BUDGET_STATUSES = ['unused', 'within_budget', 'at_budget', 'over_budget'] as const;

function budgetsOf(value: unknown) {
  const budgets = shape(value, ['byCurrency', 'month', 'monthLabel']);
  if (typeof budgets.month !== 'string' || !/^\d{4}-(?:0[1-9]|1[0-2])$/.test(budgets.month))
    refuse();
  return {
    month: budgets.month,
    monthLabel: text(budgets.monthLabel, CONTEXT_LIMITS.labelMax),
    byCurrency: list(budgets.byCurrency, CONTEXT_LIMITS.currencies, (item) => {
      const group = shape(item, [
        'categories',
        'currency',
        'omittedCount',
        'overBudgetCount',
        'overall',
        'totalBudgeted',
        'totalSpent',
      ]);
      const currency = currencyOf(group.currency);
      const budgetFact = (fact: unknown) => {
        const entry = shape(fact, [
          'budgeted',
          'name',
          'overspent',
          'percentUsed',
          'remaining',
          'spent',
          'status',
        ]);
        const budgeted = money(entry.budgeted, currency);
        const spent = money(entry.spent, currency);
        const remaining = money(entry.remaining, currency);
        const overspent = money(entry.overspent, currency);
        if (remaining.minor !== budgeted.minor - spent.minor) refuse();
        if (overspent.minor !== Math.max(0, spent.minor - budgeted.minor)) refuse();
        return {
          name: text(entry.name, CONTEXT_LIMITS.nameMax),
          budgeted,
          spent,
          remaining,
          overspent,
          percentUsed: integer(entry.percentUsed, 0, 10_000_000),
          status: oneOf(entry.status, BUDGET_STATUSES),
        };
      };
      return {
        currency,
        totalBudgeted: nullable(group.totalBudgeted, (amount) => money(amount, currency)),
        totalSpent: money(group.totalSpent, currency),
        overall: nullable(group.overall, budgetFact),
        categories: list(group.categories, CONTEXT_LIMITS.budgetCategories, budgetFact),
        overBudgetCount: integer(group.overBudgetCount, 0, 100_000),
        omittedCount: integer(group.omittedCount, 0, 100_000),
      };
    }),
  };
}

function accountsOf(value: unknown) {
  const accounts = shape(value, ['byCurrency']);
  return {
    byCurrency: list(accounts.byCurrency, CONTEXT_LIMITS.currencies, (item) => {
      const group = shape(item, ['accountCount', 'accounts', 'currency', 'totalBalance']);
      const currency = currencyOf(group.currency);
      return {
        currency,
        totalBalance: money(group.totalBalance, currency),
        accountCount: integer(group.accountCount, 0, 100_000),
        accounts: nullable(group.accounts, (entries) =>
          list(entries, CONTEXT_LIMITS.accounts, (account) => {
            const entry = shape(account, ['balance', 'name']);
            return {
              name: text(entry.name, CONTEXT_LIMITS.nameMax),
              balance: money(entry.balance, currency),
            };
          }),
        ),
      };
    }),
  };
}

function lendingOf(value: unknown) {
  const lending = shape(value, ['byCurrency']);
  return {
    byCurrency: list(lending.byCurrency, CONTEXT_LIMITS.currencies, (item) => {
      const group = shape(item, [
        'currency',
        'people',
        'peopleWithBalance',
        'totalLiability',
        'totalReceivable',
      ]);
      const currency = currencyOf(group.currency);
      return {
        currency,
        totalReceivable: money(group.totalReceivable, currency),
        totalLiability: money(group.totalLiability, currency),
        peopleWithBalance: integer(group.peopleWithBalance, 0, 100_000),
        people: nullable(group.people, (entries) =>
          list(entries, CONTEXT_LIMITS.people, (person) => {
            const entry = shape(person, ['label', 'liability', 'receivable']);
            return {
              label: text(entry.label, CONTEXT_LIMITS.nameMax),
              receivable: money(entry.receivable, currency),
              liability: money(entry.liability, currency),
            };
          }),
        ),
      };
    }),
  };
}

const RECURRING_TYPES = ['expense', 'income'] as const;

function recurringOf(value: unknown) {
  const recurring = shape(value, ['asOfDate', 'dueCount', 'items', 'moreDue', 'totals']);
  if (typeof recurring.moreDue !== 'boolean') refuse();
  return {
    asOfDate: date(recurring.asOfDate),
    dueCount: integer(recurring.dueCount, 0, 1_000),
    moreDue: recurring.moreDue,
    totals: list(recurring.totals, CONTEXT_LIMITS.recurringTotals, (item) => {
      const entry = shape(item, ['count', 'currency', 'total', 'type']);
      const currency = currencyOf(entry.currency);
      return {
        type: oneOf(entry.type, RECURRING_TYPES),
        currency,
        count: integer(entry.count, 1, 1_000),
        total: money(entry.total, currency),
      };
    }),
    items: list(recurring.items, CONTEXT_LIMITS.recurringItems, (item) => {
      const entry = shape(item, ['amount', 'category', 'date', 'type']);
      return {
        date: date(entry.date),
        type: oneOf(entry.type, RECURRING_TYPES),
        category: nullable(entry.category, (name) => text(name, CONTEXT_LIMITS.nameMax)),
        amount: money(entry.amount, null),
      };
    }),
  };
}

// Primitives ------------------------------------------------------------------

function shape(
  value: unknown,
  required: readonly string[],
  optional: readonly string[] = [],
): Record<string, unknown> {
  if (!isPlainObject(value)) refuse();
  for (const key of Object.keys(value)) {
    if (!required.includes(key) && !optional.includes(key)) refuse();
  }
  for (const key of required) if (!(key in value)) refuse();
  return value;
}

function list<T>(value: unknown, max: number, item: (entry: unknown) => T): T[] {
  if (!Array.isArray(value) || value.length > max) refuse();
  return value.map(item);
}

function nullable<T>(value: unknown, item: (entry: unknown) => T): T | null {
  return value === null ? null : item(value);
}

function oneOf<T extends string>(value: unknown, options: readonly T[]): T {
  if (typeof value !== 'string' || !(options as readonly string[]).includes(value)) refuse();
  return value as T;
}

/** Plain, short, and nothing a redaction should have removed. */
function text(value: unknown, max: number): string {
  if (typeof value !== 'string') refuse();
  const cleaned = cleanText(value);
  if (cleaned.length === 0 || cleaned.length > max) refuse();
  if (hasMarkupOrLink(cleaned) || hasUnredactedIdentifier(cleaned)) refuse();
  return cleaned;
}

function integer(value: unknown, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < min || value > max) {
    refuse();
  }
  return value;
}

function finite(value: unknown, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) refuse();
  return value;
}

function date(value: unknown): string {
  if (
    typeof value !== 'string' ||
    !/^\d{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01])$/.test(value)
  ) {
    refuse();
  }
  return value;
}

function currencyOf(value: unknown): string {
  if (typeof value !== 'string' || !/^[A-Z]{3}$/.test(value)) refuse();
  return value;
}

const DISPLAY = /^(-?)([A-Z]{3}) (\d{1,3}(?:,\d{2,3})*)\.(\d{2})$/;

/**
 * An amount: a safe integer of minor units, and the app's display string for
 * exactly that integer in exactly that currency. The display is what a model is
 * asked to quote, so it must not be able to say a different number.
 */
function money(value: unknown, currency: string | null): { minor: number; display: string } {
  const amount = shape(value, ['display', 'minor']);
  const { minor, display } = amount;
  if (typeof minor !== 'number' || !Number.isSafeInteger(minor)) refuse();
  if (typeof display !== 'string' || display.length > 40) refuse();
  const match = DISPLAY.exec(display);
  if (match === null) refuse();
  const [, sign = '', code = '', digits = '', cents = ''] = match;
  if (currency !== null && code !== currency) refuse();
  if ((sign === '-') !== minor < 0) refuse();
  if (Number(digits.replace(/,/g, '') + cents) !== Math.abs(minor)) refuse();
  return { minor, display };
}
