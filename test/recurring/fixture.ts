import * as accountService from '@/features/accounts/account.service';
import * as categoryService from '@/features/categories/category.service';
import * as recurringService from '@/features/recurring/recurring.service';
import type { CreateRecurringTemplateInput } from '@/features/recurring/recurring.types';

/**
 * Accounts and categories for recurring tests, and the milestone's fixtures.
 *
 * Every amount is a whole rupee expressed in minor units, so a test reads like
 * the plan a person would write down while the engine still sees only integers.
 */

/** Whole currency units as minor units. Money never becomes a float. */
export const rupees = (amount: number) => amount * 100;

export type RecurringFixture = ReturnType<typeof buildRecurringFixture>;

export function buildRecurringFixture() {
  const bank = accountService.createAccount({
    name: 'Bank',
    type: 'bank',
    openingBalanceMinor: rupees(1_000_000),
    currency: 'NPR',
  });
  const cash = accountService.createAccount({
    name: 'Cash',
    type: 'cash',
    openingBalanceMinor: rupees(100_000),
    currency: 'NPR',
  });
  const dollars = accountService.createAccount({
    name: 'Dollars',
    type: 'bank',
    openingBalanceMinor: rupees(10_000),
    currency: 'USD',
  });
  return {
    bank,
    cash,
    dollars,
    food: expenseCategory('Food'),
    groceries: expenseCategory('Groceries'),
    bills: expenseCategory('Bills'),
    salary: incomeCategory('Salary'),
  };
}

/** The milestone's monthly expense: rent of 20,000 on the 31st, from the bank. */
export function createRent(
  fixture: RecurringFixture,
  overrides: Partial<CreateRecurringTemplateInput> = {},
) {
  return recurringService.createRecurringTemplate({
    type: 'expense',
    amountMinor: rupees(20_000),
    categoryId: fixture.bills.id,
    accountId: fixture.bank.id,
    startDate: '2026-01-31',
    frequency: 'monthly',
    title: 'Rent',
    paymentMode: 'bank_transfer',
    ...overrides,
  });
}

/** A monthly food expense on the 15th, from June: the due-enumeration fixture. */
export function createGroceryRun(
  fixture: RecurringFixture,
  overrides: Partial<CreateRecurringTemplateInput> = {},
) {
  return recurringService.createRecurringTemplate({
    type: 'expense',
    amountMinor: rupees(5_000),
    categoryId: fixture.food.id,
    accountId: fixture.bank.id,
    startDate: '2026-06-15',
    frequency: 'monthly',
    title: 'Food box',
    ...overrides,
  });
}

/** Monthly salary into the bank, on the 1st. */
export function createSalary(
  fixture: RecurringFixture,
  overrides: Partial<CreateRecurringTemplateInput> = {},
) {
  return recurringService.createRecurringTemplate({
    type: 'income',
    amountMinor: rupees(65_000),
    categoryId: fixture.salary.id,
    accountId: fixture.bank.id,
    startDate: '2026-06-01',
    frequency: 'monthly',
    title: 'Salary',
    ...overrides,
  });
}

export function expenseCategory(name: string) {
  const category = categoryService.listExpenseCategories().find((item) => item.name === name);
  if (category === undefined) throw new Error(`Seed has no expense category named "${name}".`);
  return category;
}

export function incomeCategory(name: string) {
  const category = categoryService.listIncomeCategories().find((item) => item.name === name);
  if (category === undefined) throw new Error(`Seed has no income category named "${name}".`);
  return category;
}
