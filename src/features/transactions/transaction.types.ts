import type { PaymentMode } from '@/db/constants';
import type { NewTransaction, Transaction } from '@/db/schema/transactions';

export type { Transaction };

export type CreateExpenseInput = {
  amountMinor: number;
  categoryId: number;
  accountId: number;
  transactionDate: Date;
  title?: string | null;
  note?: string | null;
  paymentMode?: PaymentMode | null;
};

export type CreateIncomeInput = CreateExpenseInput;
export type UpdateExpenseInput = Partial<CreateExpenseInput>;
export type UpdateIncomeInput = Partial<CreateIncomeInput>;

export type CreateTransferInput = {
  amountMinor: number;
  sourceAccountId: number;
  destinationAccountId: number;
  transactionDate: Date;
  note?: string | null;
};

export type UpdateTransferInput = Partial<CreateTransferInput>;

export type TransactionView = Transaction & {
  categoryName: string | null;
  categoryIcon: string | null;
  accountId: number | null;
  accountName: string | null;
  accountIcon: string | null;
  accountType: string | null;
};

export type CreateTransactionRecord = Pick<
  NewTransaction,
  | 'type'
  | 'amountMinor'
  | 'currency'
  | 'categoryId'
  | 'sourceAccountId'
  | 'destinationAccountId'
  | 'personId'
  | 'paymentMode'
  | 'transactionDate'
  | 'title'
  | 'note'
  | 'createdAt'
  | 'updatedAt'
>;

export type UpdateTransactionRecord = Pick<NewTransaction, 'updatedAt'> &
  Partial<
    Pick<
      NewTransaction,
      | 'amountMinor'
      | 'currency'
      | 'categoryId'
      | 'sourceAccountId'
      | 'destinationAccountId'
      | 'paymentMode'
      | 'transactionDate'
      | 'title'
      | 'note'
    >
  >;
