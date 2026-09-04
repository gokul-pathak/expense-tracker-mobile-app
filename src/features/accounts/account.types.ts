import type { Account, NewAccount } from '@/db/schema/accounts';
import type { AccountType } from '@/db/constants';

export type { Account };

export type CreateAccountInput = {
  name: string;
  type: AccountType;
  openingBalanceMinor: number;
  currency: string;
  icon?: string | null;
};

export type UpdateAccountInput = Partial<CreateAccountInput>;

export type CreateAccountRecord = Pick<
  NewAccount,
  'name' | 'type' | 'openingBalanceMinor' | 'currency' | 'icon' | 'createdAt' | 'updatedAt'
>;

export type UpdateAccountRecord = Pick<NewAccount, 'updatedAt'> &
  Partial<Pick<NewAccount, 'name' | 'type' | 'openingBalanceMinor' | 'currency' | 'icon'>>;
