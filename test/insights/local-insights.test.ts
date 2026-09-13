import { describe, expect, it, vi } from 'vitest';

vi.mock('@/db', async () => await import('../support/test-database'));

import type { FinancialAssistantContext } from '@/features/insights/financial-context.types';
import { formatChange, insightsFromContext } from '@/features/insights/local-insights';
import { formatMinorUnits } from '@/utils/money';

/**
 * The cards Spending Insights shows with no AI at all.
 *
 * Built from a context by pure functions, so each rule — a previous period of
 * zero, negative savings, an overspent budget — is asserted on the sentence a
 * person reads.
 */

const m = (minor: number, currency = 'NPR') => ({
  minor,
  display: formatMinorUnits(minor, currency),
});

function context(sections: Partial<FinancialAssistantContext>): FinancialAssistantContext {
  return {
    contextVersion: 1,
    snapshotDate: '2026-09-13',
    period: {
      kind: 'this_month',
      label: 'September 2026 (this month)',
      start: '2026-09-01',
      end: '2026-09-30',
    },
    notes: [],
    ...sections,
  };
}

const AUGUST = {
  kind: 'month' as const,
  label: 'August 2026',
  start: '2026-08-01',
  end: '2026-08-31',
};

function trend(current: number, previous: number, percent: number | null) {
  return {
    previousPeriod: AUGUST,
    byCurrency: [
      {
        currency: 'NPR',
        currentExpense: m(current),
        previousExpense: m(previous),
        expenseDifference: m(current - previous),
        expensePercentChange: percent,
        currentIncome: m(0),
        previousIncome: m(0),
        incomeDifference: m(0),
        categoryChanges: [],
      },
    ],
  };
}

function budget(name: string, budgeted: number, spent: number) {
  return {
    name,
    budgeted: m(budgeted),
    spent: m(spent),
    remaining: m(budgeted - spent),
    overspent: m(Math.max(0, spent - budgeted)),
    percentUsed: Math.round((spent / budgeted) * 100),
    status: spent > budgeted ? ('over_budget' as const) : ('within_budget' as const),
  };
}

describe('spending', () => {
  it('states negative savings plainly', () => {
    const [card] = insightsFromContext(
      context({
        summary: [
          { currency: 'NPR', income: m(1_000_000), expense: m(1_500_000), savings: m(-500_000) },
        ],
      }),
    );
    expect(card).toMatchObject({ title: 'Spent', value: { minor: 1_500_000, currency: 'NPR' } });
    expect(card?.description).toBe(
      'Income NPR 10,000.00. Expenses exceeded income by NPR 5,000.00.',
    );
  });

  it('keeps currencies apart', () => {
    const cards = insightsFromContext(
      context({
        summary: [
          { currency: 'NPR', income: m(0), expense: m(1_000_000), savings: m(-1_000_000) },
          {
            currency: 'USD',
            income: m(0, 'USD'),
            expense: m(5_000, 'USD'),
            savings: m(-5_000, 'USD'),
          },
        ],
      }),
    );
    expect(cards.map((card) => card.title)).toEqual(['Spent in NPR', 'Spent in USD']);
    expect(cards.map((card) => card.value)).toEqual([
      { minor: 1_000_000, currency: 'NPR' },
      { minor: 5_000, currency: 'USD' },
    ]);
  });

  it('names the top category by amount, with its share', () => {
    const cards = insightsFromContext(
      context({
        categories: [
          {
            currency: 'NPR',
            totalExpense: m(2_500_000),
            top: [{ category: 'Food', amount: m(1_000_000), sharePercent: 40 }],
            otherCategories: null,
            unlisted: null,
          },
        ],
      }),
    );
    expect(cards[0]).toMatchObject({
      title: 'Top spending category',
      description: 'Food — 40% of spending.',
    });
  });
});

describe('comparison with the previous period', () => {
  it('gives the difference and percentage when there was something to compare with', () => {
    const [card] = insightsFromContext(context({ trend: trend(3_000_000, 2_000_000, 50) }));
    expect(card).toMatchObject({
      title: 'Expenses vs August 2026',
      value: { minor: 1_000_000, currency: 'NPR' },
      description: '+NPR 10,000.00 (+50%) compared with NPR 20,000.00 in August 2026.',
    });
  });

  it('never divides by a previous period of zero', () => {
    const [card] = insightsFromContext(context({ trend: trend(500_000, 0, null) }));
    expect(card?.description).toBe(
      'NPR 5,000.00 this period, compared with no recorded expenses in August 2026.',
    );
    expect(JSON.stringify(card)).not.toMatch(/Infinity|NaN/);
  });

  it('shows a decrease with a true minus', () => {
    const [card] = insightsFromContext(context({ trend: trend(1_700_000, 2_000_000, -15) }));
    expect(card?.description).toBe(
      '-NPR 3,000.00 (−15%) compared with NPR 20,000.00 in August 2026.',
    );
  });

  it('says so when neither period had expenses', () => {
    const [card] = insightsFromContext(context({ trend: trend(0, 0, null) }));
    expect(card?.value).toBeNull();
    expect(card?.description).toBe('No expenses were recorded in this period or in August 2026.');
  });

  it.each([
    [null, 'no previous amount'],
    [18.4, '+18%'],
    [-4.6, '−5%'],
    [0.2, '+<1%'],
    [-0.3, '−<1%'],
  ])('formats %s as %s', (percent, text) => {
    expect(formatChange(percent)).toBe(text);
  });
});

describe('budgets', () => {
  const budgets = (categories: ReturnType<typeof budget>[]) => ({
    month: '2026-09',
    monthLabel: 'September 2026',
    byCurrency: [
      {
        currency: 'NPR',
        totalBudgeted: m(categories.reduce((total, fact) => total + fact.budgeted.minor, 0)),
        totalSpent: m(categories.reduce((total, fact) => total + fact.spent.minor, 0)),
        overall: null,
        categories,
        overBudgetCount: categories.filter((fact) => fact.status === 'over_budget').length,
        omittedCount: 0,
      },
    ],
  });

  it('says how far one budget is over, as a measurement', () => {
    const [card] = insightsFromContext(
      context({ budgets: budgets([budget('Food', 1_500_000, 1_700_000)]) }),
    );
    expect(card).toMatchObject({
      tone: 'over_budget',
      value: { minor: 200_000, currency: 'NPR' },
      description: 'Food is NPR 2,000.00 over its September 2026 budget.',
    });
  });

  it('counts several budgets over', () => {
    const [card] = insightsFromContext(
      context({
        budgets: budgets([
          budget('Food', 1_500_000, 1_700_000),
          budget('Travel', 500_000, 600_000),
        ]),
      }),
    );
    expect(card?.description).toBe('2 budgets are over their September 2026 amount.');
  });

  it('says none are over without praise', () => {
    const [card] = insightsFromContext(
      context({
        budgets: budgets([budget('Food', 1_500_000, 500_000), budget('Travel', 500_000, 100_000)]),
      }),
    );
    expect(card).toMatchObject({
      tone: 'information',
      description: '2 budgets for September 2026, none over.',
    });
  });
});

describe('money owed and recurring transactions', () => {
  it('never calls money owed income or expense', () => {
    const [card] = insightsFromContext(
      context({
        lending: {
          byCurrency: [
            {
              currency: 'NPR',
              totalReceivable: m(2_000_000),
              totalLiability: m(800_000),
              peopleWithBalance: 2,
              people: null,
            },
          ],
        },
      }),
    );
    expect(card).toMatchObject({
      title: 'Owed to you',
      value: { minor: 2_000_000, currency: 'NPR' },
      description: 'You owe NPR 8,000.00. Neither is counted as income or expense.',
    });
  });

  it('distinguishes due expenses from due income', () => {
    const [card] = insightsFromContext(
      context({
        recurring: {
          asOfDate: '2026-09-13',
          dueCount: 4,
          moreDue: false,
          totals: [
            { type: 'expense', currency: 'NPR', count: 3, total: m(2_300_000) },
            { type: 'income', currency: 'NPR', count: 1, total: m(6_500_000) },
          ],
          items: [],
        },
      }),
    );
    expect(card?.description).toBe('4 transactions are due: 3 expenses, 1 income.');
  });
});

it('never judges', () => {
  const cards = insightsFromContext(
    context({
      summary: [{ currency: 'NPR', income: m(0), expense: m(9_000_000), savings: m(-9_000_000) }],
      trend: trend(9_000_000, 1_000_000, 800),
      budgets: {
        month: '2026-09',
        monthLabel: 'September 2026',
        byCurrency: [
          {
            currency: 'NPR',
            totalBudgeted: m(100),
            totalSpent: m(9_000_000),
            overall: budget('Overall monthly budget', 100, 9_000_000),
            categories: [],
            overBudgetCount: 1,
            omittedCount: 0,
          },
        ],
      },
    }),
  );
  const text = cards.map((card) => `${card.title} ${card.description}`).join(' ');
  expect(text).not.toMatch(/too much|bad|terrible|careful|warning|danger|great|well done|congrat/i);
});
