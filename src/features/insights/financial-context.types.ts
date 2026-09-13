import type { DateRange } from '@/utils/date-range';

/** A recurring template produces expenses or income, never anything else. */
type RecurringTransactionType = 'expense' | 'income';

/**
 * The vocabulary of Spending Insights: what the app has already calculated,
 * shaped so it can be shown on a screen or explained by an AI.
 *
 * Every figure in a `FinancialAssistantContext` comes from an existing domain
 * service — Reports, Budgets, Recurring, Lending, account balances — and is
 * calculated before anything else sees it. An AI explains these numbers; it is
 * never asked to produce one. Nothing in this feature can change a record.
 */

export const CONTEXT_VERSION = 1;

export const INSIGHT_INTENTS = [
  'summary',
  'spending_categories',
  'largest_expenses',
  'trend',
  'budgets',
  'accounts',
  'lending',
  'recurring',
] as const;

export type InsightIntent = (typeof INSIGHT_INTENTS)[number];

export const CONTEXT_SECTIONS = [
  'summary',
  'categories',
  'largestExpenses',
  'trend',
  'budgets',
  'accounts',
  'lending',
  'recurring',
] as const;

export type ContextSectionName = (typeof CONTEXT_SECTIONS)[number];

/**
 * The only sections a question of each kind may carry. A spending question
 * never brings along balances, budgets, people or recurring schedules.
 */
export const SECTIONS_FOR_INTENT: Readonly<Record<InsightIntent, readonly ContextSectionName[]>> = {
  summary: ['summary'],
  spending_categories: ['summary', 'categories'],
  largest_expenses: ['largestExpenses'],
  trend: ['trend'],
  budgets: ['budgets'],
  accounts: ['accounts'],
  lending: ['lending'],
  recurring: ['recurring'],
};

/** How much any one context may hold, however large the history behind it. */
export const CONTEXT_LIMITS = {
  currencies: 4,
  topCategories: 8,
  largestExpenses: 5,
  categoryChanges: 6,
  budgetCategories: 12,
  accounts: 12,
  people: 10,
  recurringItems: 10,
  notes: 4,
  nameMax: 40,
  descriptionMax: 40,
  labelMax: 60,
  noteMax: 160,
} as const;

export type PeriodKind =
  | 'today'
  | 'this_week'
  | 'last_week'
  | 'this_month'
  | 'last_month'
  | 'month'
  | 'last_3_months'
  | 'last_6_months'
  | 'this_year'
  | 'last_year'
  | 'custom';

/** A period with its Reports date range: local midnight start, exclusive end. */
export type ResolvedPeriod = { kind: PeriodKind; label: string; range: DateRange };

/** An amount as integer minor units, with the app's own display string for it. */
export type ContextMoney = { minor: number; display: string };

/** `start` and `end` are inclusive local dates, `YYYY-MM-DD`. */
export type PeriodFact = { kind: PeriodKind; label: string; start: string; end: string };

export type SummaryFact = {
  currency: string;
  income: ContextMoney;
  expense: ContextMoney;
  /** Income minus expense, as Reports defines it. Negative when expenses were higher. */
  savings: ContextMoney;
};

export type CategorySpendingFact = {
  currency: string;
  totalExpense: ContextMoney;
  top: { category: string; amount: ContextMoney; sharePercent: number }[];
  /** Categories beyond the top ones, together. */
  otherCategories: { count: number; amount: ContextMoney } | null;
  /** Spending whose category has since been deleted, which Reports does not list by name. */
  unlisted: ContextMoney | null;
};

export type LargestExpensesFact = {
  currency: string;
  items: {
    date: string;
    category: string | null;
    amount: ContextMoney;
    /** The expense's own text, redacted and cut short. Untrusted. */
    description: string | null;
  }[];
};

export type TrendCurrencyFact = {
  currency: string;
  currentExpense: ContextMoney;
  previousExpense: ContextMoney;
  expenseDifference: ContextMoney;
  /** One decimal place. Null when the previous period had no expenses: never Infinity. */
  expensePercentChange: number | null;
  currentIncome: ContextMoney;
  previousIncome: ContextMoney;
  incomeDifference: ContextMoney;
  /** Largest movements first. */
  categoryChanges: {
    category: string;
    current: ContextMoney;
    previous: ContextMoney;
    difference: ContextMoney;
  }[];
};

export type TrendFact = { previousPeriod: PeriodFact; byCurrency: TrendCurrencyFact[] };

export type BudgetStatusName = 'unused' | 'within_budget' | 'at_budget' | 'over_budget';

export type BudgetFact = {
  name: string;
  budgeted: ContextMoney;
  spent: ContextMoney;
  /** Negative when overspent. */
  remaining: ContextMoney;
  overspent: ContextMoney;
  /** Rounded to a whole percent, uncapped. */
  percentUsed: number;
  status: BudgetStatusName;
};

export type BudgetsFact = {
  month: string;
  monthLabel: string;
  byCurrency: {
    currency: string;
    /** The overall budget's amount, or the category budgets' sum — never both added. */
    totalBudgeted: ContextMoney | null;
    totalSpent: ContextMoney;
    overall: BudgetFact | null;
    categories: BudgetFact[];
    overBudgetCount: number;
    omittedCount: number;
  }[];
};

export type AccountsFact = {
  byCurrency: {
    currency: string;
    /** Active accounts only. Money owed to or by people is not part of it. */
    totalBalance: ContextMoney;
    accountCount: number;
    accounts: { name: string; balance: ContextMoney }[] | null;
  }[];
};

export type LendingFact = {
  byCurrency: {
    currency: string;
    /** Money owed to the person. Not income. */
    totalReceivable: ContextMoney;
    /** Money the person owes. Not an expense. */
    totalLiability: ContextMoney;
    peopleWithBalance: number;
    /** `Person 1`… for a ranking; a name only when the question named that person. */
    people: { label: string; receivable: ContextMoney; liability: ContextMoney }[] | null;
  }[];
};

export type RecurringFact = {
  asOfDate: string;
  dueCount: number;
  /** More were due than the recurring engine returns in one read. */
  moreDue: boolean;
  totals: {
    type: RecurringTransactionType;
    currency: string;
    count: number;
    total: ContextMoney;
  }[];
  items: {
    date: string;
    type: RecurringTransactionType;
    category: string | null;
    amount: ContextMoney;
  }[];
};

/** Exactly what may be sent to explain an answer. Nothing else is. */
export type FinancialAssistantContext = {
  contextVersion: typeof CONTEXT_VERSION;
  snapshotDate: string;
  period: PeriodFact;
  /** Written by the app, never by a person: how to read the figures. */
  notes: string[];
  summary?: SummaryFact[];
  categories?: CategorySpendingFact[];
  largestExpenses?: LargestExpensesFact[];
  trend?: TrendFact;
  budgets?: BudgetsFact;
  accounts?: AccountsFact;
  lending?: LendingFact;
  recurring?: RecurringFact;
};

/** A figure the screen shows beside an answer, straight from the context. */
export type HeadlineFact = { label: string; minor: number; currency: string };

export type ContextPlan = {
  sections: readonly ContextSectionName[];
  period: ResolvedPeriod;
  /** App-written sentence about how the period was chosen, if it needs saying. */
  periodNote?: string | null;
  people: 'none' | 'ranking' | 'mentioned';
  accounts: 'totals' | 'named';
  /**
   * The question, read on the device only to notice a person or account it
   * names. It is never copied into the context.
   */
  mentionText?: string;
};

export type BuiltFinancialContext = {
  context: FinancialAssistantContext;
  headlines: HeadlineFact[];
  /** `Person 1` → the real name. Stays on the device; used to read an answer back. */
  personNames: Readonly<Record<string, string>>;
};
