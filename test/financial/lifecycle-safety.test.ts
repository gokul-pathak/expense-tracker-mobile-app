import { beforeEach, describe, expect, it, vi } from 'vitest';

const accountRepository = vi.hoisted(() => ({
  getAccountById: vi.fn(),
  hasFinancialHistory: vi.fn(),
  updateAccount: vi.fn(),
}));
const categoryRepository = vi.hoisted(() => ({
  getCategoriesByType: vi.fn(() => []),
  getCategoryById: vi.fn(),
  updateCategory: vi.fn(),
}));

vi.mock('@/features/accounts/account.repository', () => accountRepository);
vi.mock('@/features/categories/category.repository', () => categoryRepository);

import { updateAccount } from '@/features/accounts/account.service';
import { updateCategory } from '@/features/categories/category.service';

describe('financial lifecycle protections', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    accountRepository.getAccountById.mockReturnValue({ id: 1, currency: 'NPR' });
  });

  it('rejects changing an account currency after financial history exists', () => {
    accountRepository.hasFinancialHistory.mockReturnValue(true);
    expect(() => updateAccount(1, { currency: 'USD' })).toThrow('cannot change after financial history');
    expect(accountRepository.updateAccount).not.toHaveBeenCalled();
  });

  it('allows a currency correction before any financial history exists', () => {
    accountRepository.hasFinancialHistory.mockReturnValue(false);
    accountRepository.updateAccount.mockReturnValue({ id: 1, currency: 'USD' });
    expect(updateAccount(1, { currency: 'USD' })).toEqual({ id: 1, currency: 'USD' });
  });

  it('rejects unsafe opening balances', () => {
    expect(() => updateAccount(1, { openingBalanceMinor: Number.MAX_SAFE_INTEGER + 1 })).toThrow(
      'safe integer',
    );
  });

  it('protects built-in category identities from normal service updates', () => {
    categoryRepository.getCategoryById.mockReturnValue({ id: 1, isDefault: true, name: 'Food', type: 'expense' });
    expect(() => updateCategory(1, { name: 'Dining' })).toThrow('Built-in categories cannot be modified.');
    expect(categoryRepository.updateCategory).not.toHaveBeenCalled();
  });
});
