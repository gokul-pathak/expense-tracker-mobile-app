import { eq } from 'drizzle-orm';

import { db } from '@/db';
import { accounts } from '@/db/schema/accounts';
import { people } from '@/db/schema/people';
import { transactions } from '@/db/schema/transactions';
import { archiveAccount, createAccount } from '@/features/accounts/account.service';
import { getDashboardSummary } from '@/features/dashboard/dashboard.service';
import { archivePerson, createPerson } from '@/features/people/person.service';
import { ValidationError } from '@/features/shared/errors';

import { getAccountBalance, getTotalBalance } from './account-balance.service';
import {
  createBorrow,
  createLend,
  createRepaymentPaid,
  createRepaymentReceived,
  deleteTransaction,
  getPeopleFinancialSummary,
  getPersonFinancialSummary,
  getPersonTransactionHistory,
  updateBorrow,
  updateLend,
  updateRepaymentPaid,
  updateRepaymentReceived,
} from './transaction.service';

/** Invoke in a development build after database initialization. Fixtures are removed after checks. */
export function verifyLendingEngine() {
  if (!__DEV__) throw new Error('Lending verification is only available in development.');

  const accountIds: number[] = [];
  const personIds: number[] = [];
  const transactionIds: number[] = [];
  const now = new Date();
  const currentDate = new Date(now.getFullYear(), now.getMonth(), 10, 12);
  const backdated = new Date(now.getFullYear(), now.getMonth() - 1, 10, 12);

  try {
    const cash = account('M4B cash', 'cash', 2_000_000);
    const bank = account('M4B bank', 'bank', 500_000);
    const ram = person('M4B Ram');
    const sita = person('M4B Sita');
    const archivedPerson = person('M4B archived person');
    const metricsBefore = getDashboardSummary({ now });
    const totalBefore = getTotalBalance();

    const lend = createLend({
      personId: ram.id,
      amountMinor: 1_000_000,
      accountId: cash.id,
      transactionDate: currentDate,
    });
    transactionIds.push(lend.id);
    assertDebtRecord(lend, 'lend', ram.id, cash.id, 'source');
    expectError(() => updateBorrow(lend.id, { amountMinor: 1 }), ValidationError);
    assert(getAccountBalance(cash.id) === 1_000_000, 'Lend did not reduce account balance.');
    assert(getTotalBalance() === totalBefore - 1_000_000, 'Lend total balance was incorrect.');
    assertSummary(ram.id, 1_000_000, 0, 'pending');
    assertMetrics(metricsBefore, now);

    const repaymentReceived = createRepaymentReceived({
      personId: ram.id,
      amountMinor: 400_000,
      accountId: cash.id,
      transactionDate: currentDate,
    });
    transactionIds.push(repaymentReceived.id);
    assert(
      getAccountBalance(cash.id) === 1_400_000,
      'Repayment received did not increase account.',
    );
    assertSummary(ram.id, 600_000, 0, 'partially_paid');
    assertMetrics(metricsBefore, now);
    expectError(
      () =>
        createRepaymentReceived({
          personId: ram.id,
          amountMinor: 700_000,
          accountId: cash.id,
          transactionDate: currentDate,
        }),
      ValidationError,
    );
    expectError(() => updateLend(lend.id, { amountMinor: 300_000 }), ValidationError);
    expectError(
      () => updateRepaymentReceived(repaymentReceived.id, { amountMinor: 1_100_000 }),
      ValidationError,
    );
    expectError(() => deleteTransaction(lend.id), ValidationError);
    updateRepaymentReceived(repaymentReceived.id, { amountMinor: 600_000 });
    assertSummary(ram.id, 400_000, 0, 'partially_paid');
    deleteTransaction(repaymentReceived.id);
    transactionIds.splice(transactionIds.indexOf(repaymentReceived.id), 1);
    assertSummary(ram.id, 1_000_000, 0, 'pending');

    const settlement = createRepaymentReceived({
      personId: ram.id,
      amountMinor: 1_000_000,
      accountId: cash.id,
      transactionDate: currentDate,
    });
    transactionIds.push(settlement.id);
    assertSummary(ram.id, 0, 0, 'settled');
    expectError(
      () =>
        createRepaymentReceived({
          personId: ram.id,
          amountMinor: 1,
          accountId: cash.id,
          transactionDate: currentDate,
        }),
      ValidationError,
    );
    deleteTransaction(settlement.id);
    transactionIds.splice(transactionIds.indexOf(settlement.id), 1);

    const borrow = createBorrow({
      personId: sita.id,
      amountMinor: 1_200_000,
      accountId: bank.id,
      transactionDate: currentDate,
    });
    transactionIds.push(borrow.id);
    assertDebtRecord(borrow, 'borrow', sita.id, bank.id, 'destination');
    expectError(() => updateLend(borrow.id, { amountMinor: 1 }), ValidationError);
    assert(getAccountBalance(bank.id) === 1_700_000, 'Borrow did not increase account balance.');
    const repaymentPaid = createRepaymentPaid({
      personId: sita.id,
      amountMinor: 500_000,
      accountId: bank.id,
      transactionDate: currentDate,
    });
    transactionIds.push(repaymentPaid.id);
    expectError(() => updateRepaymentPaid(lend.id, { amountMinor: 1 }), ValidationError);
    assert(getAccountBalance(bank.id) === 1_200_000, 'Repayment paid did not reduce account.');
    assertSummary(sita.id, 0, 700_000, 'partially_paid');
    expectError(
      () =>
        createRepaymentPaid({
          personId: sita.id,
          amountMinor: 800_000,
          accountId: bank.id,
          transactionDate: currentDate,
        }),
      ValidationError,
    );
    expectError(() => updateBorrow(borrow.id, { amountMinor: 400_000 }), ValidationError);
    expectError(() => deleteTransaction(borrow.id), ValidationError);
    assertMetrics(metricsBefore, now);

    const aggregate = getPeopleFinancialSummary();
    assert(aggregate.totalReceivableMinor === 1_000_000, 'Aggregate receivable was incorrect.');
    assert(aggregate.totalLiabilityMinor === 700_000, 'Aggregate liability was incorrect.');

    const backdatedLend = createLend({
      personId: ram.id,
      amountMinor: 100_000,
      accountId: cash.id,
      transactionDate: backdated,
    });
    transactionIds.push(backdatedLend.id);
    assert(
      getPersonTransactionHistory(ram.id)[0]?.id === lend.id,
      'Person history was not date ordered.',
    );
    assertMetrics(metricsBefore, now);

    archivePerson(archivedPerson.id);
    expectError(
      () =>
        createLend({
          personId: archivedPerson.id,
          amountMinor: 1,
          accountId: cash.id,
          transactionDate: currentDate,
        }),
      ValidationError,
    );
    archivePerson(ram.id);
    assert(
      getPersonTransactionHistory(ram.id).length === 2,
      'Archived person history was unavailable.',
    );
    assertSummary(ram.id, 1_100_000, 0, 'pending');
    archiveAccount(bank.id);
    assert(
      getPersonTransactionHistory(sita.id).length === 2,
      'Archived account history was unavailable.',
    );
    expectError(
      () =>
        createRepaymentPaid({
          personId: sita.id,
          amountMinor: 1,
          accountId: bank.id,
          transactionDate: currentDate,
        }),
      ValidationError,
    );

    return { lending: true };
  } finally {
    for (const id of transactionIds) db.delete(transactions).where(eq(transactions.id, id)).run();
    for (const id of personIds) db.delete(people).where(eq(people.id, id)).run();
    for (const id of accountIds) db.delete(accounts).where(eq(accounts.id, id)).run();
  }

  function account(name: string, type: 'cash' | 'bank', openingBalanceMinor: number) {
    const created = createAccount({ name, type, openingBalanceMinor, currency: 'NPR' });
    accountIds.push(created.id);
    return created;
  }

  function person(name: string) {
    const created = createPerson({ name });
    personIds.push(created.id);
    return created;
  }
}

function assertDebtRecord(
  transaction: {
    type: string;
    categoryId: number | null;
    personId: number | null;
    sourceAccountId: number | null;
    destinationAccountId: number | null;
  },
  type: string,
  personId: number,
  accountId: number,
  accountSide: 'source' | 'destination',
) {
  assert(
    transaction.type === type &&
      transaction.categoryId === null &&
      transaction.personId === personId &&
      (accountSide === 'source'
        ? transaction.sourceAccountId === accountId && transaction.destinationAccountId === null
        : transaction.destinationAccountId === accountId && transaction.sourceAccountId === null),
    `${type} record mapping was incorrect.`,
  );
}

function assertSummary(personId: number, receivable: number, liability: number, status: string) {
  const summary = getPersonFinancialSummary(personId);
  assert(
    summary.receivableMinor === receivable &&
      summary.liabilityMinor === liability &&
      summary.status === status,
    'Person financial summary was incorrect.',
  );
}

function assertMetrics(before: ReturnType<typeof getDashboardSummary>, now: Date) {
  const current = getDashboardSummary({ now });
  assert(
    current.monthlyIncomeMinor === before.monthlyIncomeMinor &&
      current.monthlyExpenseMinor === before.monthlyExpenseMinor &&
      current.monthlySavingsMinor === before.monthlySavingsMinor &&
      current.categorySpending.length === before.categorySpending.length,
    'Debt transaction changed income, expense, savings, or category spending.',
  );
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function expectError(action: () => unknown, ErrorType: new (...args: never[]) => Error) {
  try {
    action();
  } catch (error) {
    if (error instanceof ErrorType) return;
    throw error;
  }
  throw new Error(`Expected ${ErrorType.name}.`);
}
