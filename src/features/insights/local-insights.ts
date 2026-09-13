import { buildFinancialContext } from './financial-context.service';
import type {
  ContextSectionName,
  FinancialAssistantContext,
  ResolvedPeriod,
} from './financial-context.types';

/**
 * Insight cards that need no AI, no network and no account.
 *
 * Built from the same deterministic context an AI explanation would use, so
 * the cards and any explanation beside them can never disagree about a number.
 * They are what Spending Insights shows offline, signed out, rate limited, with
 * AI turned off, or when a provider is down.
 *
 * Neutral, always. `over_budget` is a measurement, not a warning, and nothing
 * here congratulates or scolds.
 */

export type LocalFinancialInsight = {
  id: string;
  title: string;
  value: { minor: number; currency: string } | null;
  description: string;
  tone: 'information' | 'over_budget';
};

const OVERVIEW_SECTIONS: readonly ContextSectionName[] = [
  'summary',
  'categories',
  'trend',
  'budgets',
  'lending',
  'recurring',
];

export function buildLocalInsights(
  period: ResolvedPeriod,
  now: Date = new Date(),
): LocalFinancialInsight[] {
  const { context } = buildFinancialContext(
    { sections: OVERVIEW_SECTIONS, period, people: 'none', accounts: 'totals' },
    now,
  );
  return insightsFromContext(context);
}

export function insightsFromContext(context: FinancialAssistantContext): LocalFinancialInsight[] {
  const insights: LocalFinancialInsight[] = [];

  for (const fact of context.summary ?? []) {
    const { income, expense, savings } = fact;
    let description: string;
    if (income.minor === 0 && expense.minor === 0) {
      description = 'No income or expenses were recorded in this period.';
    } else if (savings.minor < 0) {
      description = `Income ${income.display}. Expenses exceeded income by ${positive(savings.display)}.`;
    } else {
      description = `Income ${income.display}. Savings ${savings.display}.`;
    }
    insights.push({
      id: `spent-${fact.currency}`,
      title: context.summary!.length > 1 ? `Spent in ${fact.currency}` : 'Spent',
      value: { minor: expense.minor, currency: fact.currency },
      description,
      tone: 'information',
    });
  }

  const topGroup = context.categories?.find((fact) => fact.top.length > 0);
  const top = topGroup?.top[0];
  if (topGroup !== undefined && top !== undefined) {
    insights.push({
      id: `top-category-${topGroup.currency}`,
      title: 'Top spending category',
      value: { minor: top.amount.minor, currency: topGroup.currency },
      description: `${top.category} — ${top.sharePercent}% of spending.`,
      tone: 'information',
    });
  }

  const trend = context.trend?.byCurrency[0];
  if (context.trend !== undefined && trend !== undefined) {
    const previous = context.trend.previousPeriod.label;
    const { currentExpense, previousExpense, expenseDifference, expensePercentChange } = trend;
    let description: string;
    let value: LocalFinancialInsight['value'] = {
      minor: expenseDifference.minor,
      currency: trend.currency,
    };
    if (previousExpense.minor === 0 && currentExpense.minor === 0) {
      description = `No expenses were recorded in this period or in ${previous}.`;
      value = null;
    } else if (previousExpense.minor === 0) {
      description = `${currentExpense.display} this period, compared with no recorded expenses in ${previous}.`;
    } else if (expenseDifference.minor === 0) {
      description = `The same as ${previous}: ${currentExpense.display}.`;
    } else {
      const sign = expenseDifference.minor > 0 ? '+' : '';
      description = `${sign}${expenseDifference.display} (${formatChange(expensePercentChange)}) compared with ${previousExpense.display} in ${previous}.`;
    }
    insights.push({
      id: `trend-${trend.currency}`,
      title: `Expenses vs ${previous}`,
      value,
      description,
      tone: 'information',
    });
  }

  if (context.budgets !== undefined) {
    const { monthLabel } = context.budgets;
    for (const group of context.budgets.byCurrency) {
      const facts = [group.overall, ...group.categories].filter((fact) => fact !== null);
      const over = facts.filter((fact) => fact.status === 'over_budget');
      if (facts.length === 0) continue;
      if (over.length === 1) {
        insights.push({
          id: `budget-${group.currency}`,
          title: 'Budget',
          value: { minor: over[0]!.overspent.minor, currency: group.currency },
          description: `${over[0]!.name} is ${over[0]!.overspent.display} over its ${monthLabel} budget.`,
          tone: 'over_budget',
        });
      } else if (group.overBudgetCount > 1) {
        insights.push({
          id: `budget-${group.currency}`,
          title: 'Budgets',
          value: null,
          description: `${group.overBudgetCount} budgets are over their ${monthLabel} amount.`,
          tone: 'over_budget',
        });
      } else {
        insights.push({
          id: `budget-${group.currency}`,
          title: 'Budgets',
          value: null,
          description: `${plural(facts.length + group.omittedCount, 'budget')} for ${monthLabel}, none over.`,
          tone: 'information',
        });
      }
    }
  }

  for (const group of context.lending?.byCurrency ?? []) {
    if (group.totalReceivable.minor === 0 && group.totalLiability.minor === 0) continue;
    insights.push({
      id: `lending-${group.currency}`,
      title: 'Owed to you',
      value: { minor: group.totalReceivable.minor, currency: group.currency },
      description: `You owe ${group.totalLiability.display}. Neither is counted as income or expense.`,
      tone: 'information',
    });
  }

  const recurring = context.recurring;
  if (recurring !== undefined && recurring.dueCount > 0) {
    const expenses = recurring.totals
      .filter((total) => total.type === 'expense')
      .reduce((count, total) => count + total.count, 0);
    const income = recurring.dueCount - expenses;
    const parts = [
      expenses > 0 ? plural(expenses, 'expense') : null,
      income > 0 ? `${income} income` : null,
    ].filter((part) => part !== null);
    insights.push({
      id: 'recurring',
      title: 'Recurring',
      value: null,
      description: `${plural(recurring.dueCount, 'transaction')} ${recurring.dueCount === 1 ? 'is' : 'are'} due${recurring.moreDue ? ' or more' : ''}: ${parts.join(', ')}.`,
      tone: 'information',
    });
  }

  return insights;
}

/** `+18%`, `−5%`, `<1%`. Never Infinity, because a null change is handled before this. */
export function formatChange(percent: number | null): string {
  if (percent === null) return 'no previous amount';
  const rounded = Math.round(percent);
  if (rounded === 0) return percent > 0 ? '+<1%' : '−<1%';
  return rounded > 0 ? `+${rounded}%` : `−${Math.abs(rounded)}%`;
}

function positive(display: string): string {
  return display.startsWith('-') ? display.slice(1) : display;
}

function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? '' : 's'}`;
}
