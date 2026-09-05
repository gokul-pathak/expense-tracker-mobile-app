export {
  listAccounts,
  listActiveAccounts,
  listArchivedAccounts,
  getAccount,
  createAccount,
  updateAccount,
  archiveAccount,
  unarchiveAccount,
} from '@/features/accounts/account.service';
export {
  listCategories,
  listExpenseCategories,
  listIncomeCategories,
  getCategory,
  createCategory,
  updateCategory,
} from '@/features/categories/category.service';
export {
  listPeople,
  listActivePeople,
  listArchivedPeople,
  getPerson,
  createPerson,
  updatePerson,
  archivePerson,
  unarchivePerson,
} from '@/features/people/person.service';
export { getAppSettings, updateDefaultCurrency } from '@/features/settings/settings.service';
export {
  createExpense,
  createIncome,
  deleteTransaction,
  getTransaction,
  getTransactionView,
  listTransactionViews,
  updateExpense,
  updateIncome,
} from '@/features/transactions/transaction.service';

export const isLocalFinanceDataAvailable = true;
