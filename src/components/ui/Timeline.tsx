import { StyleSheet, View } from 'react-native';

import { useTheme } from '@/theme';

import { Money, type MoneyDirection } from './Money';
import { Text } from './Text';

export type TimelineEntry = {
  key: string | number;
  /** What happened, in plain words: "You gave", "Sujan paid". */
  label: string;
  /** When and where, on one line under the label. */
  detail: string;
  minorUnits: number;
  currency: string;
  direction: MoneyDirection;
};

type Props = {
  entries: TimelineEntry[];
};

const DOT = 9;

/**
 * A vertical hairline with a dot at each event. Used for a person's lending
 * history, where the order of events is the whole story — a stack of cards
 * would say these are separate things, when what matters is that each one
 * followed the last.
 */
export function Timeline({ entries }: Props) {
  const { palette, space } = useTheme();

  return (
    <View>
      {entries.map((entry, index) => {
        const last = index === entries.length - 1;
        const dotColor =
          entry.direction === 'expense'
            ? palette.negative
            : entry.direction === 'income'
              ? palette.positive
              : palette.textTertiary;

        return (
          <View key={entry.key} style={[styles.row, { gap: space.md + 2 }]}>
            <View style={styles.rail}>
              <View
                style={[
                  styles.dot,
                  { backgroundColor: dotColor, borderColor: palette.canvas, marginTop: 5 },
                ]}
              />
              {last ? null : <View style={[styles.line, { backgroundColor: palette.hairline }]} />}
            </View>
            <View style={[styles.body, { paddingBottom: last ? 0 : space.xl, gap: 2 }]}>
              <View style={styles.head}>
                <Text variant="bodyStrong" numberOfLines={1} style={styles.label}>
                  {entry.label}
                </Text>
                <Money
                  minorUnits={entry.minorUnits}
                  currency={entry.currency}
                  size="row"
                  direction={entry.direction}
                  showCode={false}
                  align="right"
                />
              </View>
              <Text variant="caption" tone="tertiary">
                {entry.detail}
              </Text>
            </View>
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row' },
  rail: { width: DOT, alignItems: 'center' },
  dot: { width: DOT, height: DOT, borderRadius: DOT / 2, borderWidth: 2 },
  line: { flex: 1, width: StyleSheet.hairlineWidth, marginTop: 2 },
  body: { flex: 1, minWidth: 0 },
  head: { flexDirection: 'row', alignItems: 'baseline', gap: 8 },
  label: { flex: 1 },
});
