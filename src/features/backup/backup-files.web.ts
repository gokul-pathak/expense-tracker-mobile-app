const unavailable = () => {
  throw new Error('Backup and export are available in the Android/iOS app.');
};
export const shareTransactionsCsv = unavailable;
export const shareTransactionsJson = unavailable;
export const shareFullDataJson = unavailable;
export const createAndShareBackup = unavailable;
export const chooseBackup = unavailable;
export const restoreChosenBackup = unavailable;
