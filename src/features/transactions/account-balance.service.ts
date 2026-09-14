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
  const lentMinor = transactionRepository.getAccountLendTotal(accountId);
  const borrowedMinor = transactionRepository.getAccountBorrowTotal(accountId);
  const repaymentsReceivedMinor = transactionRepository.getAccountRepaymentReceivedTotal(accountId);
  const repaymentsPaidMinor = transactionRepository.getAccountRepaymentPaidTotal(accountId);
  // Investment cash moves through its linked transactions only. The trades
  // themselves are never summed here, so no purchase is counted twice.
  const investedMinor = transactionRepository.getAccountInvestmentTotal(accountId);
  const investmentReturnsMinor = transactionRepository.getAccountInvestmentReturnTotal(accountId);
  const balance =
    account.openingBalanceMinor +
    incomeMinor -
    expenseMinor +
    transferReceivedMinor -
    transferSentMinor -
    lentMinor +
    borrowedMinor +
    repaymentsReceivedMinor -
    repaymentsPaidMinor -
    investedMinor +
    investmentReturnsMinor;

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
    transactionRepository.getExpenseTotal() -
    transactionRepository.getLendTotal() +
    transactionRepository.getBorrowTotal() +
    transactionRepository.getRepaymentReceivedTotal() -
    transactionRepository.getRepaymentPaidTotal() -
    // Cash, not worth: money moved into an investment leaves the cash total, and
    // what the investment is worth is a separate figure that is never added here.
    transactionRepository.getInvestmentTotal() +
    transactionRepository.getInvestmentReturnTotal();
  if (!Number.isSafeInteger(total)) {
    throw new ValidationError('Total balance exceeds supported integer minor-unit precision.');
  }
  return total;
}
