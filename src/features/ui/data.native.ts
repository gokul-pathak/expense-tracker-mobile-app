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
export { getHomeBudgetSummary } from '@/features/dashboard/dashboard-budget.service';
export { getAccountBalance } from '@/features/transactions/account-balance.service';
export { getBudgetComparisonForMonths } from '@/features/budgets/budget.reporting';
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

export {
  createRecurringTemplate,
  getRecurringTemplate,
  listRecurringTemplates,
  updateRecurringTemplate,
  pauseRecurringTemplate,
  resumeRecurringTemplate,
  deleteRecurringTemplate,
  listDueOccurrences,
  getNextDueDate,
  generateOccurrence,
  skipOccurrence,
  generateDueOccurrences,
  getRecurringHomeSummary,
  listTemplateHistory,
  getRecurringProvenance,
  countOutstandingOccurrences,
} from '@/features/recurring/recurring.service';

export {
  captureReceiptFromCamera,
  importReceiptFromLibrary,
} from '@/features/receipts/capture/receipt-capture.service';
export {
  cleanupExpiredReceiptDrafts,
  discardReceiptDraft,
  keepReceiptDraftAlive,
  processReceiptDraft,
  registerCapturedReceipt,
} from '@/features/receipts/receipt-processing.service';
export { getReceiptDraft } from '@/features/receipts/receipt-draft.repository';
export { isReceiptScanningAvailable } from '@/features/receipts/ocr/receipt-ocr';
export { saveReceiptExpense } from '@/features/receipts/review/receipt-save.service';

// Spending Insights reads only. Nothing exported here for it can write.
export { buildFinancialContext } from '@/features/insights/financial-context.service';
export { buildLocalInsights } from '@/features/insights/local-insights';
export { resolvePresetPeriod as resolveInsightPeriod } from '@/features/insights/insight-period';
export { contextPlanFor, routeInsightQuestion } from '@/features/insights/insight-router';

// Investments. Every figure is derived by these services from assets, trades and
// manual prices; a screen formats what they return and computes nothing itself.
export {
  addPrice as addInvestmentPrice,
  archiveAsset as archiveInvestmentAsset,
  buyAsset as buyInvestment,
  createAsset as createInvestmentAsset,
  deletePrice as deleteInvestmentPrice,
  deleteTrade as deleteInvestmentTrade,
  getAsset as getInvestmentAsset,
  getPrice as getInvestmentPrice,
  getTrade as getInvestmentTrade,
  listAssets as listInvestmentAssets,
  recordDividend as recordInvestmentDividend,
  sellAsset as sellInvestment,
  unarchiveAsset as unarchiveInvestmentAsset,
  updatePrice as updateInvestmentPrice,
  updateTrade as updateInvestmentTrade,
} from '@/features/investments/investment.service';
export {
  getAssetDetail as getInvestmentAssetDetail,
  getPortfolioOverview,
  getPortfolioSummary,
} from '@/features/investments/portfolio.service';
export {
  getSellableQuantity,
  previewBuy as previewInvestmentBuy,
  previewSell as previewInvestmentSell,
} from '@/features/investments/trade-preview.service';

// Figures in more than one currency are read one currency at a time.
export { getPeopleFinancialSummaryByCurrency } from '@/features/transactions/transaction.service';
export { listReportCurrencies } from '@/features/reports/reports.service';

export const isLocalFinanceDataAvailable = true;
