import * as accountService from '@/features/accounts/account.service';
import * as budgetService from '@/features/budgets/budget.service';
import * as categoryService from '@/features/categories/category.service';
import * as personService from '@/features/people/person.service';
import * as transactionService from '@/features/transactions/transaction.service';

/**
 * The September 2026 fixture the milestone specifies, built once and reused.
 *
 * Every figure below is a whole rupee expressed in minor units, so the tests
 * read like the plan a person would write down while the engine still sees only
 * integers.
 */

/** Whole currency units as minor units. Money never becomes a float. */
export const rupees = (amount: number) => amount * 100;

export const SEPTEMBER = '2026-09';
export const AUGUST = '2026-08';

const day = (dayOfMonth: number, monthIndex = 8) => new Date(2026, monthIndex, dayOfMonth);

export type BudgetFixture = ReturnType<typeof buildFixture>;

/**
 * Accounts, people and categories, with no budgets and no transactions yet.
 * Opening balances are generous because budgets are unrelated to balances and a
 * short account would only add noise.
 */
export function buildFixture() {
  const cash = accountService.createAccount({
    name: 'Cash',
    type: 'cash',
    openingBalanceMinor: rupees(1_000_000),
    currency: 'NPR',
  });
  const bank = accountService.createAccount({
    name: 'Bank',
    type: 'bank',
    openingBalanceMinor: rupees(1_000_000),
    currency: 'NPR',
  });
  const dollars = accountService.createAccount({
    name: 'Dollars',
    type: 'bank',
    openingBalanceMinor: rupees(10_000),
    currency: 'USD',
  });
  const person = personService.createPerson({ name: 'Ram' });

  return {
    cash,
    bank,
    dollars,
    person,
    food: expenseCategoryNamed('Food'),
    travel: expenseCategoryNamed('Travel'),
    shopping: expenseCategoryNamed('Shopping'),
    salary: incomeCategoryNamed('Salary'),
  };
}

/** The three budgets from the specification: overall, Food and Travel. */
export function createSeptemberBudgets(fixture: BudgetFixture) {
  return {
    overall: budgetService.createBudget({
      periodMonth: SEPTEMBER,
      amountMinor: rupees(40_000),
    }),
    food: budgetService.createBudget({
      categoryId: fixture.food.id,
      periodMonth: SEPTEMBER,
      amountMinor: rupees(15_000),
    }),
    travel: budgetService.createBudget({
      categoryId: fixture.travel.id,
      periodMonth: SEPTEMBER,
      amountMinor: rupees(10_000),
    }),
  };
}

/**
 * The specified activity: four expenses that count, and six records of other
 * types that must not.
 */
export function createSeptemberActivity(fixture: BudgetFixture) {
  const expense = (categoryId: number, amount: number, title: string, dayOfMonth: number) =>
    transactionService.createExpense({
      accountId: fixture.cash.id,
      categoryId,
      amountMinor: rupees(amount),
      title,
      paymentMode: 'cash',
      transactionDate: day(dayOfMonth),
    });

  const foodA = expense(fixture.food.id, 5_000, 'Dinner', 3);
  const foodB = expense(fixture.food.id, 4_000, 'Groceries run', 11);
  const travel = expense(fixture.travel.id, 7_500, 'Bus fare', 14);
  const shopping = expense(fixture.shopping.id, 3_000, 'Shoes', 18);

  const income = transactionService.createIncome({
    accountId: fixture.bank.id,
    categoryId: fixture.salary.id,
    amountMinor: rupees(65_000),
    title: 'Salary',
    transactionDate: day(1),
  });
  const transfer = transactionService.createTransfer({
    sourceAccountId: fixture.bank.id,
    destinationAccountId: fixture.cash.id,
    amountMinor: rupees(20_000),
    transactionDate: day(2),
  });
  const lend = transactionService.createLend({
    personId: fixture.person.id,
    accountId: fixture.cash.id,
    amountMinor: rupees(8_000),
    transactionDate: day(5),
  });
  const borrow = transactionService.createBorrow({
    personId: fixture.person.id,
    accountId: fixture.cash.id,
    amountMinor: rupees(5_000),
    transactionDate: day(6),
  });
  const repaymentReceived = transactionService.createRepaymentReceived({
    personId: fixture.person.id,
    accountId: fixture.cash.id,
    amountMinor: rupees(2_000),
    transactionDate: day(20),
  });
  const repaymentPaid = transactionService.createRepaymentPaid({
    personId: fixture.person.id,
    accountId: fixture.cash.id,
    amountMinor: rupees(1_000),
    transactionDate: day(21),
  });

  return {
    foodA,
    foodB,
    travel,
    shopping,
    income,
    transfer,
    lend,
    borrow,
    repaymentReceived,
    repaymentPaid,
  };
}

export function expenseCategoryNamed(name: string) {
  const category = categoryService.listExpenseCategories().find((item) => item.name === name);
  if (category === undefined) throw new Error(`Seed has no expense category named "${name}".`);
  return category;
}

export function incomeCategoryNamed(name: string) {
  const category = categoryService.listIncomeCategories().find((item) => item.name === name);
  if (category === undefined) throw new Error(`Seed has no income category named "${name}".`);
  return category;
}
