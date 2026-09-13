import { describe, expect, it } from 'vitest';

import { getQuickAddTiles } from '@/features/quick-add/quick-add-tiles';

/**
 * What Quick Add offers. The sheet renders exactly this list.
 */
describe('Quick Add', () => {
  it('offers Scan Receipt last on a build that can read a receipt', () => {
    const tiles = getQuickAddTiles({ receiptScanning: true });

    expect(tiles.map((tile) => tile.title)).toEqual([
      'Expense',
      'Income',
      'Transfer',
      'Lend / Borrow',
      'Scan Receipt',
    ]);
    const scan = tiles[tiles.length - 1];
    expect(scan?.route).toBe('/receipt/scan');
    expect(scan?.icon).toBe('scan-line');
  });

  it('does not spend the accent colour on the scan tile', () => {
    const scan = getQuickAddTiles({ receiptScanning: true }).find(
      (tile) => tile.title === 'Scan Receipt',
    );
    expect(scan?.tone).toBe('neutral');
  });

  it('offers no scanning at all on a build without an OCR engine', () => {
    const tiles = getQuickAddTiles({ receiptScanning: false });

    expect(tiles.map((tile) => tile.title)).toEqual([
      'Expense',
      'Income',
      'Transfer',
      'Lend / Borrow',
    ]);
  });
});
