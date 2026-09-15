import type { IconName } from '@/components/ui';
import { getQuickAddTiles, type QuickAddTile } from '@/features/quick-add/quick-add-tiles';

/**
 * Home's shortcuts, as data.
 *
 * The money actions are Quick Add's own tiles, so a route or a label changes in
 * one place and the FAB and Home never disagree. Home adds two ways in that are
 * not a kind of money: a person, because lending starts with one, and the last
 * slot — Scan Receipt on a build that can read a receipt, the accounts list on
 * one that cannot — so the grid is always six.
 */
export type HomeShortcut = {
  route: string;
  icon: IconName;
  label: string;
  tone: QuickAddTile['tone'];
};

const SCAN_RECEIPT_ROUTE = '/receipt/scan';

const ADD_PERSON: HomeShortcut = {
  route: '/people/new',
  icon: 'user',
  label: 'Add Person',
  tone: 'neutral',
};

const ACCOUNTS: HomeShortcut = {
  route: '/accounts',
  icon: 'wallet',
  label: 'Accounts',
  tone: 'neutral',
};

export function getHomeShortcuts(options: { receiptScanning: boolean }): HomeShortcut[] {
  const tiles: HomeShortcut[] = getQuickAddTiles(options).map((tile) => ({
    route: tile.route,
    icon: tile.icon,
    label: tile.title,
    tone: tile.tone,
  }));
  const scan = tiles.find((tile) => tile.route === SCAN_RECEIPT_ROUTE);
  const money = tiles.filter((tile) => tile.route !== SCAN_RECEIPT_ROUTE);
  return [...money, ADD_PERSON, scan ?? ACCOUNTS];
}
