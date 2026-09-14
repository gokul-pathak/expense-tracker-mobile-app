import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

/**
 * What the investment UI must never become, checked in the source.
 *
 * No chart library and no market data: prices are typed by a person. No figure
 * computed in a screen: arithmetic reaches the UI only through the services. No
 * investment advice from the AI assistant, which stays spending-focused. And no
 * fifth tab: Investments lives under More.
 */

const root = join(dirname(fileURLToPath(import.meta.url)), '../..');

function* walk(directory: string): Generator<string> {
  if (!existsSync(directory)) return;
  for (const entry of readdirSync(directory)) {
    const path = join(directory, entry);
    if (statSync(path).isDirectory()) yield* walk(path);
    else if (/\.(ts|tsx)$/.test(path)) yield path;
  }
}

const name = (path: string) => relative(root, path).split(sep).join('/');
const read = (path: string) => readFileSync(path, 'utf8');

const featureFiles = [...walk(join(root, 'src/features/investments'))];
const screenFiles = [...walk(join(root, 'src/app/investments'))];
/** Every file that renders investment figures. */
const uiFiles = [
  ...screenFiles,
  ...featureFiles.filter((file) => file.endsWith('.tsx')),
  join(root, 'src/app/(tabs)/index.tsx'),
  join(root, 'src/app/(tabs)/more.tsx'),
];

describe('investment UI boundaries', () => {
  it('adds no chart library and no market-data, brokerage or wallet package', () => {
    const manifest = JSON.parse(read(join(root, 'package.json'))) as {
      dependencies: Record<string, string>;
      devDependencies: Record<string, string>;
    };
    const packages = Object.keys({ ...manifest.dependencies, ...manifest.devDependencies });
    expect(
      packages.filter((item) =>
        /chart|victory|\bd3\b|skia|plot|finance|stock|market|ticker|broker|alpaca|polygon|finnhub|yahoo|coingecko|binance|wallet|ethers|web3/i.test(
          item,
        ),
      ),
    ).toEqual([]);
  });

  it('never reaches the network: every price is entered by hand', () => {
    const offenders = [...featureFiles, ...screenFiles]
      .filter((file) =>
        /\bfetch\(|axios|XMLHttpRequest|WebSocket|https?:\/\/|supabase|functions\.invoke/i.test(
          read(file),
        ),
      )
      .map(name);
    expect(offenders).toEqual([]);
  });

  it('computes no figure in a screen: the math and the replay reach the UI only through services', () => {
    const offenders = uiFiles
      .filter((file) =>
        new RegExp(
          "import\\s+(?!type\\b)[^;]*?from\\s+'(?:\\./|@/features/investments/)(?:investment-math|investment-replay|investment\\.repository|investment\\.service|portfolio\\.service|trade-preview\\.service)'",
        ).test(read(file)),
      )
      .map(name);
    expect(offenders).toEqual([]);
  });

  it('keeps the AI assistant spending-focused: nothing in it reads investments', () => {
    const files = [
      ...walk(join(root, 'src/features/ai')),
      ...walk(join(root, 'src/features/insights')),
      ...walk(join(root, 'src/app/insights')),
      ...walk(join(root, 'supabase/functions')),
    ];
    const offenders = files
      .filter((file) =>
        /features\/investments|getPortfolio|listHoldings|getAssetDetail|previewBuy|previewSell/.test(
          read(file),
        ),
      )
      .map(name);
    expect(offenders).toEqual([]);
  });

  it('puts Investments under More rather than adding a tab, and leaves Quick Add alone', () => {
    const tabs = read(join(root, 'src/app/(tabs)/_layout.tsx'));
    expect([...tabs.matchAll(/Tabs\.Screen name="([^"]+)"/g)].map((match) => match[1])).toEqual([
      'index',
      'transactions',
      'reports',
      'more',
    ]);
    expect(read(join(root, 'src/app/(tabs)/more.tsx'))).toContain("router.push('/investments'");
    for (const file of walk(join(root, 'src/features/quick-add'))) {
      expect(read(file), name(file)).not.toMatch(/invest/i);
    }
  });

  it('never folds what investments are worth into Total Balance', () => {
    const cash = [
      'src/features/transactions/account-balance.service.ts',
      'src/features/dashboard/dashboard.service.ts',
      'src/features/dashboard/dashboard.repository.ts',
    ]
      .map((file) => read(join(root, file)))
      .join('\n');
    expect(cash).not.toMatch(/portfolio|marketValue|getHolding|listHoldings|investment_prices/);
  });

  it('offers no gesture that deletes a trade without its confirmation', () => {
    const offenders = uiFiles
      .filter((file) => /Swipeable|GestureDetector|PanResponder|onLongPress/.test(read(file)))
      .map(name);
    expect(offenders).toEqual([]);
  });
});
