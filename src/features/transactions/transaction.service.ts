import { PAYMENT_MODES, type PaymentMode } from '@/db/constants';
import { getAccountById } from '@/features/accounts/account.repository';
import { getCategoryById } from '@/features/categories/category.repository';
import { NotFoundError, ValidationError } from '@/features/shared/errors';

import * as repository from './transaction.repository';
import type {
  CreateExpenseInput,
  CreateIncomeInput,
  CreateTransferInput,
  CreateTransactionRecord,
  Transaction,
  UpdateExpenseInput,
  UpdateIncomeInput,
  UpdateTransferInput,
  UpdateTransactionRecord,
} from './transaction.types';

type CategorizedTransactionType = 'expense' | 'income';

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

export function deleteTransaction(id: number) {
  assertSupported(repository.getTransactionById(id) ?? notFound(id));
  return repository.deleteTransaction(id) ?? notFound(id);
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

function getAccount(id: number) {
  return getAccountById(id) ?? accountNotFound(id);
}

function requireTransferAccountId(value: number | null, role: 'source' | 'destination') {
  if (value === null) throw new ValidationError(`Transfer ${role} account is required.`);
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
    transaction.type !== 'transfer'
  ) {
    throw new ValidationError(`Transaction type "${transaction.type}" is not supported.`);
  }
  return transaction;
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
