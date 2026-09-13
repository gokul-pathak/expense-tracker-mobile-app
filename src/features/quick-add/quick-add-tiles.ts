import type { IconName } from '@/components/ui';

/**
 * What Quick Add offers, as data.
 *
 * Kept apart from the sheet so the choice of tiles — and in particular whether
 * Scan Receipt is offered — is decided in one testable place rather than in a
 * component.
 */
export type QuickAddTile = {
  route: string;
  icon: IconName;
  title: string;
  description: string;
  /** Which palette colour tints the chip and the tile border. */
  tone: 'negative' | 'positive' | 'neutral' | 'accent';
  /** Full width, larger chip, larger title. */
  primary?: boolean;
  /** Chip beside the text rather than above it. */
  horizontal?: boolean;
};

const MONEY_TILES: readonly QuickAddTile[] = [
  {
    route: '/transaction/expense/new',
    icon: 'arrow-up-right',
    title: 'Expense',
    description: 'Money you spent',
    tone: 'negative',
    primary: true,
  },
  {
    route: '/transaction/income/new',
    icon: 'arrow-down-left',
    title: 'Income',
    description: 'Money received',
    tone: 'positive',
  },
  {
    route: '/transaction/transfer/new',
    icon: 'arrow-left-right',
    title: 'Transfer',
    description: 'Between accounts',
    tone: 'neutral',
  },
  {
    route: '/transaction/people',
    icon: 'handshake',
    title: 'Lend / Borrow',
    description: 'Money with people',
    tone: 'accent',
    horizontal: true,
  },
];

/**
 * Neutral, not the accent: Lend / Borrow already spends the one accent colour
 * on this sheet, and a scan is a way of entering an expense, not a new kind of
 * money.
 */
const SCAN_RECEIPT_TILE: QuickAddTile = {
  route: '/receipt/scan',
  icon: 'scan-line',
  title: 'Scan Receipt',
  description: 'From a photo of a receipt',
  tone: 'neutral',
  horizontal: true,
};

/**
 * Scan Receipt is last, and only on a build that can read a receipt. A tile
 * that always answers "unavailable" would be a promise the app cannot keep, so
 * without an OCR engine it is simply not offered.
 */
export function getQuickAddTiles(options: { receiptScanning: boolean }): QuickAddTile[] {
  return options.receiptScanning ? [...MONEY_TILES, SCAN_RECEIPT_TILE] : [...MONEY_TILES];
}
