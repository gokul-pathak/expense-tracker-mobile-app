import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { getHomeShortcuts } from '@/features/dashboard/home-shortcuts';
import { getQuickAddTiles } from '@/features/quick-add/quick-add-tiles';

const root = join(dirname(fileURLToPath(import.meta.url)), '../..');

function screenExists(route: string) {
  const base = join(root, 'src/app', route);
  return existsSync(base + '.tsx') || existsSync(join(base, 'index.tsx'));
}

describe('Home shortcuts', () => {
  it('opens the same money forms as Quick Add, then a person, in a grid of six', () => {
    const shortcuts = getHomeShortcuts({ receiptScanning: false });
    expect(shortcuts.map((shortcut) => shortcut.label)).toEqual([
      'Expense',
      'Income',
      'Transfer',
      'Lend / Borrow',
      'Add Person',
      'Accounts',
    ]);
    const quickAddRoutes = getQuickAddTiles({ receiptScanning: false }).map((tile) => tile.route);
    expect(shortcuts.slice(0, 4).map((shortcut) => shortcut.route)).toEqual(quickAddRoutes);
  });

  it('offers Scan Receipt only on a build that can read a receipt', () => {
    const withScanning = getHomeShortcuts({ receiptScanning: true });
    expect(withScanning).toHaveLength(6);
    expect(withScanning[5]?.label).toBe('Scan Receipt');
    expect(
      getHomeShortcuts({ receiptScanning: false }).some((item) => item.label === 'Scan Receipt'),
    ).toBe(false);
  });

  it('points every shortcut at a screen that exists', () => {
    const routes = [
      ...getHomeShortcuts({ receiptScanning: true }),
      ...getHomeShortcuts({ receiptScanning: false }),
    ].map((shortcut) => shortcut.route);
    expect(routes.filter((route) => !screenExists(route))).toEqual([]);
  });
});
