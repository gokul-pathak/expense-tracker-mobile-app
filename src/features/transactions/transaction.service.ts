import { PAYMENT_MODES, type PaymentMode } from '@/db/constants';
import { getAccountById } from '@/features/accounts/account.repository';
import { getCategoryById } from '@/features/categories/category.repository';
import { getPerson as getPersonById } from '@/features/people/person.service';
import { NotFoundError, ValidationError } from '@/features/shared/errors';

import * as repository from './transaction.repository';
import type {
  CreateBorrowInput,
  CreateExpenseInput,
  CreateIncomeInput,
  CreateLendInput,
  CreateRepaymentPaidInput,
  CreateRepaymentReceivedInput,
  CreateTransferInput,
  CreateTransactionRecord,
  PersonFinancialSummary,
  Transaction,
  UpdateBorrowInput,
  UpdateExpenseInput,
  UpdateIncomeInput,
  UpdateLendInput,
  UpdateRepaymentPaidInput,
  UpdateRepaymentReceivedInput,
  UpdateTransferInput,
  UpdateTransactionRecord,
} from './transaction.types';

type CategorizedTransactionType = 'expense' | 'income';
type DebtTransactionType = 'lend' | 'borrow' | 'repayment_received' | 'repayment_paid';
type DebtInput =
  CreateLendInput | CreateBorrowInput | CreateRepaymentReceivedInput | CreateRepaymentPaidInput;
type DebtUpdateInput =
  UpdateLendInput | UpdateBorrowInput | UpdateRepaymentReceivedInput | UpdateRepaymentPaidInput;

export function createExpense(input: CreateExpenseInput) {
  return createTransaction('expense', input);
}

export function createIncome(input: CreateIncomeInput) {
  return createTransaction('income', input);
}

export function createTransfer(input: CreateTransferInput) {
  const sourceAccount = getActiveAccount(input.sourceAccountId);
  const destinationAccount = getActiveAccount(input.destinationAccountId);
  validateTransferAccounts(sourceAccount, destinationAccount);

  const now = new Date();
  return repository.createTransaction({
    type: 'transfer',
    amountMinor: normalizeAmount(input.amountMinor),
    currency: sourceAccount.currency,
    categoryId: null,
    personId: null,
    sourceAccountId: sourceAccount.id,
    destinationAccountId: destinationAccount.id,
    paymentMode: null,
    transactionDate: normalizeTransactionDate(input.transactionDate),
    title: 'Transfer',
    note: normalizeOptionalText(input.note, 'Note') ?? null,
    createdAt: now,
    updatedAt: now,
  });
}

export function createLend(input: CreateLendInput) {
  return createDebtTransaction('lend', input);
}

export function createBorrow(input: CreateBorrowInput) {
  return createDebtTransaction('borrow', input);
}

export function createRepaymentReceived(input: CreateRepaymentReceivedInput) {
  return createDebtTransaction('repayment_received', input);
}

export function createRepaymentPaid(input: CreateRepaymentPaidInput) {
  return createDebtTransaction('repayment_paid', input);
}

export function getTransaction(id: number) {
  return assertSupported(repository.getTransactionById(id) ?? notFound(id));
}

export function listTransactions() {
  return repository.getTransactions().map(assertSupported);
}

export function listTransactionViews() {
  return repository.getTransactionViews();
}

export function getTransactionView(id: number) {
  return repository.getTransactionViewById(id) ?? notFound(id);
}

export function updateExpense(id: number, input: UpdateExpenseInput) {
  return updateTransaction(id, 'expense', input);
}

export function updateIncome(id: number, input: UpdateIncomeInput) {
  return updateTransaction(id, 'income', input);
}

export function updateTransfer(id: number, input: UpdateTransferInput) {
  const current = getTransaction(id);
  if (current.type !== 'transfer') {
    throw new ValidationError(`Transaction ${id} is not a transfer.`);
  }
  if (Object.keys(input).length === 0) {
    throw new ValidationError('Provide at least one transaction field to update.');
  }

  const data: Omit<UpdateTransactionRecord, 'updatedAt'> = {};
  if (input.amountMinor !== undefined) data.amountMinor = normalizeAmount(input.amountMinor);
  if (input.transactionDate !== undefined) {
    data.transactionDate = normalizeTransactionDate(input.transactionDate);
  }
  if (input.note !== undefined) data.note = normalizeOptionalText(input.note, 'Note');

  if (input.sourceAccountId !== undefined || input.destinationAccountId !== undefined) {
    const sourceAccount =
      input.sourceAccountId !== undefined
        ? getActiveAccount(input.sourceAccountId)
        : getAccount(requireTransferAccountId(current.sourceAccountId, 'source'));
    const destinationAccount =
      input.destinationAccountId !== undefined
        ? getActiveAccount(input.destinationAccountId)
        : getAccount(requireTransferAccountId(current.destinationAccountId, 'destination'));
    validateTransferAccounts(sourceAccount, destinationAccount);
    data.sourceAccountId = sourceAccount.id;
    data.destinationAccountId = destinationAccount.id;
    data.currency = sourceAccount.currency;
  }

  return repository.updateTransaction(id, { ...data, updatedAt: new Date() }) ?? notFound(id);
}

export function updateLend(id: number, input: UpdateLendInput) {
  return updateDebtTransaction(id, 'lend', input);
}

export function updateBorrow(id: number, input: UpdateBorrowInput) {
  return updateDebtTransaction(id, 'borrow', input);
}

export function updateRepaymentReceived(id: number, input: UpdateRepaymentReceivedInput) {
  return updateDebtTransaction(id, 'repayment_received', input);
}

export function updateRepaymentPaid(id: number, input: UpdateRepaymentPaidInput) {
  return updateDebtTransaction(id, 'repayment_paid', input);
}

export function deleteTransaction(id: number) {
  const transaction = assertSupported(repository.getTransactionById(id) ?? notFound(id));
  if (isDebtTransaction(transaction.type)) {
    const personId = requirePersonId(transaction.personId);
    assertDebtInvariants(personId, transaction.type, undefined, id);
  }
  return repository.deleteTransaction(id) ?? notFound(id);
}

export function getPersonFinancialSummary(personId: number): PersonFinancialSummary {
  getPersonById(personId);
  return toPersonFinancialSummary(personId, repository.getPersonDebtTotals(personId));
}

export function getPeopleFinancialSummary() {
  const people = repository
    .getPeopleDebtTotals()
    .map((person) => toPersonFinancialSummary(person.personId, person));
  people.sort((left, right) => {
    const leftOutstanding = left.receivableMinor + left.liabilityMinor;
    const rightOutstanding = right.receivableMinor + right.liabilityMinor;
    return rightOutstanding - leftOutstanding || left.personId - right.personId;
  });
  return {
    totalReceivableMinor: people.reduce((total, person) => total + person.receivableMinor, 0),
    totalLiabilityMinor: people.reduce((total, person) => total + person.liabilityMinor, 0),
    people,
  };
}

export function getPersonTransactionHistory(personId: number) {
  getPersonById(personId);
  return repository.getPersonTransactionItems(personId);
}

function createTransaction(
  type: CategorizedTransactionType,
  input: CreateExpenseInput | CreateIncomeInput,
) {
  const account = getActiveAccount(input.accountId);
  const category = getCategoryById(input.categoryId) ?? categoryNotFound(input.categoryId);
  if (category.type !== type) {
    throw new ValidationError(`${capitalize(type)} transactions require a ${type} category.`);
  }

  const now = new Date();
  const common = normalizeCreateCommon(input, account.currency);
  const record: CreateTransactionRecord = {
    ...common,
    type,
    categoryId: category.id,
    personId: null,
    sourceAccountId: type === 'expense' ? account.id : null,
    destinationAccountId: type === 'income' ? account.id : null,
    createdAt: now,
    updatedAt: now,
  };
  return repository.createTransaction(record);
}

function createDebtTransaction(type: DebtTransactionType, input: DebtInput) {
  const person = getActivePerson(input.personId);
  const account = getActiveAccount(input.accountId);
  const amountMinor = normalizeAmount(input.amountMinor);
  assertDebtCurrency(person.id, account.currency);
  assertDebtInvariants(person.id, type, amountMinor);

  const now = new Date();
  return repository.createTransaction({
    type,
    amountMinor,
    currency: account.currency,
    categoryId: null,
    personId: person.id,
    sourceAccountId: type === 'lend' || type === 'repayment_paid' ? account.id : null,
    destinationAccountId: type === 'borrow' || type === 'repayment_received' ? account.id : null,
    paymentMode: null,
    transactionDate: normalizeTransactionDate(input.transactionDate),
    title: debtTitle(type),
    note: normalizeOptionalText(input.note, 'Note') ?? null,
    createdAt: now,
    updatedAt: now,
  });
}

function updateTransaction(
  id: number,
  type: CategorizedTransactionType,
  input: UpdateExpenseInput | UpdateIncomeInput,
) {
  const current = getTransaction(id);
  if (current.type !== type) {
    throw new ValidationError(`Transaction ${id} is not an ${type}.`);
  }
  if (Object.keys(input).length === 0) {
    throw new ValidationError('Provide at least one transaction field to update.');
  }

  const data: Omit<UpdateTransactionRecord, 'updatedAt'> = {};
  if (input.amountMinor !== undefined) data.amountMinor = normalizeAmount(input.amountMinor);
  if (input.categoryId !== undefined) {
    const category = getCategoryById(input.categoryId) ?? categoryNotFound(input.categoryId);
    if (category.type !== type) {
      throw new ValidationError(`${capitalize(type)} transactions require a ${type} category.`);
    }
    data.categoryId = category.id;
  }
  if (input.accountId !== undefined) {
    const account = getActiveAccount(input.accountId);
    data.currency = account.currency;
    if (type === 'expense') data.sourceAccountId = account.id;
    else data.destinationAccountId = account.id;
  }
  if (input.transactionDate !== undefined)
    data.transactionDate = normalizeTransactionDate(input.transactionDate);
  if (input.title !== undefined) data.title = normalizeTitle(input.title);
  if (input.note !== undefined) data.note = normalizeOptionalText(input.note, 'Note');
  if (input.paymentMode !== undefined) data.paymentMode = normalizePaymentMode(input.paymentMode);

  if (Object.keys(data).length === 0) {
    throw new ValidationError('Provide at least one permitted transaction field to update.');
  }
  return repository.updateTransaction(id, { ...data, updatedAt: new Date() }) ?? notFound(id);
}

function updateDebtTransaction(id: number, type: DebtTransactionType, input: DebtUpdateInput) {
  const current = getTransaction(id);
  if (current.type !== type) throw new ValidationError(`Transaction ${id} is not a ${type}.`);
  if (Object.keys(input).length === 0) {
    throw new ValidationError('Provide at least one transaction field to update.');
  }

  const currentPersonId = requirePersonId(current.personId);
  const person =
    input.personId === undefined ? getPersonById(currentPersonId) : getActivePerson(input.personId);
  const accountId =
    type === 'lend' || type === 'repayment_paid'
      ? requireDebtAccountId(current.sourceAccountId)
      : requireDebtAccountId(current.destinationAccountId);
  const account =
    input.accountId === undefined ? getAccount(accountId) : getActiveAccount(input.accountId);
  const amountMinor =
    input.amountMinor === undefined ? current.amountMinor : normalizeAmount(input.amountMinor);

  // Removing a transaction from its current person must not leave their repayments unsupported.
  if (person.id !== currentPersonId) {
    assertDebtInvariants(currentPersonId, type, undefined, id);
  }
  assertDebtCurrency(person.id, account.currency, id);
  assertDebtInvariants(person.id, type, amountMinor, id);

  const data: Omit<UpdateTransactionRecord, 'updatedAt'> = {
    amountMinor,
    personId: person.id,
    currency: account.currency,
    sourceAccountId: type === 'lend' || type === 'repayment_paid' ? account.id : null,
    destinationAccountId: type === 'borrow' || type === 'repayment_received' ? account.id : null,
  };
  if (input.transactionDate !== undefined)
    data.transactionDate = normalizeTransactionDate(input.transactionDate);
  if (input.note !== undefined) data.note = normalizeOptionalText(input.note, 'Note');
  return repository.updateTransaction(id, { ...data, updatedAt: new Date() }) ?? notFound(id);
}

function normalizeCreateCommon(input: CreateExpenseInput | CreateIncomeInput, currency: string) {
  return {
    amountMinor: normalizeAmount(input.amountMinor),
    currency,
    paymentMode: normalizePaymentMode(input.paymentMode),
    transactionDate: normalizeTransactionDate(input.transactionDate),
    title: normalizeTitle(input.title),
    note: normalizeOptionalText(input.note, 'Note') ?? null,
  };
}

function getActiveAccount(id: number) {
  const account = getAccount(id);
  if (account.isArchived) throw new ValidationError('Choose an active account.');
  return account;
}

function getActivePerson(id: number) {
  const person = getPersonById(id);
  if (person.isArchived) throw new ValidationError('Choose an active person.');
  return person;
}

function getAccount(id: number) {
  return getAccountById(id) ?? accountNotFound(id);
}

function requireTransferAccountId(value: number | null, role: 'source' | 'destination') {
  if (value === null) throw new ValidationError(`Transfer ${role} account is required.`);
  return value;
}

function requireDebtAccountId(value: number | null) {
  if (value === null) throw new ValidationError('Debt transaction account is required.');
  return value;
}

function requirePersonId(value: number | null) {
  if (value === null) throw new ValidationError('Debt transaction person is required.');
  return value;
}

function validateTransferAccounts(
  sourceAccount: ReturnType<typeof getAccount>,
  destinationAccount: ReturnType<typeof getAccount>,
) {
  if (sourceAccount.id === destinationAccount.id) {
    throw new ValidationError('Source and destination accounts must be different.');
  }
  if (sourceAccount.currency !== destinationAccount.currency) {
    throw new ValidationError('Transfers between different currencies are not supported yet.');
  }
}

function normalizeAmount(value: unknown) {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0) {
    throw new ValidationError('Amount must be a positive integer number of minor units.');
  }
  return value;
}

function normalizeTransactionDate(value: unknown) {
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) {
    throw new ValidationError('Transaction date must be a valid date.');
  }
  return value;
}

function normalizeTitle(value: unknown) {
  if (value === undefined || value === null) return '';
  if (typeof value !== 'string') throw new ValidationError('Title must be text.');
  return value.trim();
}

function normalizeOptionalText(value: unknown, field: string): string | null | undefined {
  if (value === undefined || value === null) return value;
  if (typeof value !== 'string') throw new ValidationError(`${field} must be text.`);
  return value.trim() || null;
}

function normalizePaymentMode(value: unknown): PaymentMode | null | undefined {
  if (value === undefined || value === null) return value;
  if (typeof value !== 'string' || !PAYMENT_MODES.includes(value as PaymentMode)) {
    throw new ValidationError('Payment mode is invalid.');
  }
  return value as PaymentMode;
}

function assertSupported(transaction: Transaction) {
  if (
    transaction.type !== 'income' &&
    transaction.type !== 'expense' &&
    transaction.type !== 'transfer' &&
    !isDebtTransaction(transaction.type)
  ) {
    throw new ValidationError(`Transaction type "${transaction.type}" is not supported.`);
  }
  return transaction;
}

function isDebtTransaction(type: Transaction['type']): type is DebtTransactionType {
  return (
    type === 'lend' ||
    type === 'borrow' ||
    type === 'repayment_received' ||
    type === 'repayment_paid'
  );
}

function assertDebtCurrency(personId: number, currency: string, excludeTransactionId?: number) {
  const currencies = repository.getPersonDebtCurrencies(personId, excludeTransactionId);
  if (currencies.some((existingCurrency) => existingCurrency !== currency)) {
    throw new ValidationError('Multiple currencies for one person are not supported yet.');
  }
}

function assertDebtInvariants(
  personId: number,
  type: DebtTransactionType,
  candidateAmountMinor: number | undefined,
  excludeTransactionId?: number,
) {
  const totals = repository.getPersonDebtTotals(personId, excludeTransactionId);
  const lentMinor = totals.lentMinor + (type === 'lend' ? (candidateAmountMinor ?? 0) : 0);
  const borrowedMinor =
    totals.borrowedMinor + (type === 'borrow' ? (candidateAmountMinor ?? 0) : 0);
  const repaymentsReceivedMinor =
    totals.repaymentsReceivedMinor +
    (type === 'repayment_received' ? (candidateAmountMinor ?? 0) : 0);
  const repaymentsPaidMinor =
    totals.repaymentsPaidMinor + (type === 'repayment_paid' ? (candidateAmountMinor ?? 0) : 0);

  if (repaymentsReceivedMinor > lentMinor) {
    throw new ValidationError('Repayments received cannot exceed money lent to this person.');
  }
  if (repaymentsPaidMinor > borrowedMinor) {
    throw new ValidationError('Repayments paid cannot exceed money borrowed from this person.');
  }
}

function toPersonFinancialSummary(
  personId: number,
  totals: ReturnType<typeof repository.getPersonDebtTotals>,
): PersonFinancialSummary {
  const receivableMinor = totals.lentMinor - totals.repaymentsReceivedMinor;
  const liabilityMinor = totals.borrowedMinor - totals.repaymentsPaidMinor;
  const hasRepayment = totals.repaymentsReceivedMinor > 0 || totals.repaymentsPaidMinor > 0;
  return {
    personId,
    receivableMinor,
    liabilityMinor,
    netMinor: receivableMinor - liabilityMinor,
    status:
      receivableMinor === 0 && liabilityMinor === 0
        ? 'settled'
        : hasRepayment
          ? 'partially_paid'
          : 'pending',
  };
}

function debtTitle(type: DebtTransactionType) {
  switch (type) {
    case 'lend':
      return 'Lend';
    case 'borrow':
      return 'Borrow';
    case 'repayment_received':
      return 'Repayment received';
    case 'repayment_paid':
      return 'Repayment paid';
  }
}

function capitalize(value: string) {
  return `${value[0]?.toUpperCase()}${value.slice(1)}`;
}

function notFound(id: number): never {
  throw new NotFoundError(`Transaction ${id} was not found.`);
}

function accountNotFound(id: number): never {
  throw new NotFoundError(`Account ${id} was not found.`);
}

function categoryNotFound(id: number): never {
  throw new NotFoundError(`Category ${id} was not found.`);
}
