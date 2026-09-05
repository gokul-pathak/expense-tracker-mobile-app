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

export type CreateLendInput = {
  personId: number;
  amountMinor: number;
  accountId: number;
  transactionDate: Date;
  note?: string | null;
};

export type CreateBorrowInput = CreateLendInput;
export type CreateRepaymentReceivedInput = CreateLendInput;
export type CreateRepaymentPaidInput = CreateLendInput;

export type UpdateLendInput = Partial<CreateLendInput>;
export type UpdateBorrowInput = Partial<CreateBorrowInput>;
export type UpdateRepaymentReceivedInput = Partial<CreateRepaymentReceivedInput>;
export type UpdateRepaymentPaidInput = Partial<CreateRepaymentPaidInput>;

export type PersonFinancialStatus = 'pending' | 'partially_paid' | 'settled';

export type PersonFinancialSummary = {
  personId: number;
  receivableMinor: number;
  liabilityMinor: number;
  netMinor: number;
  status: PersonFinancialStatus;
};

export type PeopleFinancialSummary = {
  totalReceivableMinor: number;
  totalLiabilityMinor: number;
  people: PersonFinancialSummary[];
};

export type PersonTransactionItem = {
  id: number;
  type: 'lend' | 'borrow' | 'repayment_received' | 'repayment_paid';
  amountMinor: number;
  accountId: number;
  accountName: string;
  accountIcon: string | null;
  transactionDate: Date;
  note: string | null;
};

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
      | 'personId'
      | 'paymentMode'
      | 'transactionDate'
      | 'title'
      | 'note'
    >
  >;
