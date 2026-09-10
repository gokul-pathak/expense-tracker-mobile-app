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
  shareTransactionsCsv,
  shareTransactionsJson,
  shareFullDataJson,
  createAndShareBackup,
  chooseBackup,
  restoreChosenBackup,
} from '@/features/backup/backup-files.native';
export { getDashboardSummary } from '@/features/dashboard/dashboard.service';
export { getAccountBalance } from '@/features/transactions/account-balance.service';
export {
  createBudget,
  deleteBudget,
  getBudget,
  getBudgetProgress,
  getMonthlyBudgetSummary,
  listBudgets,
  listBudgetsForMonth,
  updateBudget,
} from '@/features/budgets/budget.service';
export {
  getCustomRange,
  getExpenseCategoryBreakdown,
  getIncomeExpenseTrend,
  getRecommendedGranularity,
  getReportRange,
  getReportSummary,
  getSimpleInsights,
} from '@/features/reports/reports.service';
export {
  createExpense,
  createIncome,
  createTransfer,
  createLend,
  createBorrow,
  createRepaymentReceived,
  createRepaymentPaid,
  deleteTransaction,
  getTransaction,
  getTransactionView,
  listTransactionViews,
  updateExpense,
  updateIncome,
  updateTransfer,
  updateLend,
  updateBorrow,
  updateRepaymentReceived,
  updateRepaymentPaid,
  getPersonFinancialSummary,
  getPeopleFinancialSummary,
  getPersonTransactionHistory,
} from '@/features/transactions/transaction.service';

export const isLocalFinanceDataAvailable = true;
