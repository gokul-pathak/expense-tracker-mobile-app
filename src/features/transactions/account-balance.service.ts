import { NotFoundError, ValidationError } from '@/features/shared/errors';

import * as accountRepository from '@/features/accounts/account.repository';

import * as transactionRepository from './transaction.repository';

export function getAccountBalance(accountId: number) {
  const account = accountRepository.getAccountById(accountId);
  if (!account) throw new NotFoundError(`Account ${accountId} was not found.`);

  const incomeMinor = transactionRepository.getAccountIncomeTotal(accountId);
  const expenseMinor = transactionRepository.getAccountExpenseTotal(accountId);
  const transferReceivedMinor = transactionRepository.getAccountTransferReceivedTotal(accountId);
  const transferSentMinor = transactionRepository.getAccountTransferSentTotal(accountId);
  const balance =
    account.openingBalanceMinor +
    incomeMinor -
    expenseMinor +
    transferReceivedMinor -
    transferSentMinor;

  if (!Number.isSafeInteger(balance)) {
    throw new ValidationError('Account balance exceeds supported integer minor-unit precision.');
  }
  return balance;
}

export function getTotalBalance() {
  const openingBalanceMinor = accountRepository
    .getAccounts()
    .reduce((sum, account) => sum + account.openingBalanceMinor, 0);
  const total =
    openingBalanceMinor +
    transactionRepository.getIncomeTotal() -
    transactionRepository.getExpenseTotal();
  if (!Number.isSafeInteger(total)) {
    throw new ValidationError('Total balance exceeds supported integer minor-unit precision.');
  }
  return total;
}
