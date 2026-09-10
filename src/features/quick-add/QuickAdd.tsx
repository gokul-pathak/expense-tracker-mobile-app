import * as Haptics from 'expo-haptics';
import { router } from 'expo-router';
import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type PropsWithChildren,
} from 'react';
import { Platform, Pressable, StyleSheet, View } from 'react-native';

import { BottomSheet, Icon, Text, type IconName } from '@/components/ui';
import { useTheme, withAlpha } from '@/theme';

type QuickAddApi = { open: () => void; close: () => void };

const QuickAddContext = createContext<QuickAddApi | undefined>(undefined);

/**
 * Quick Add is a sheet over whatever screen you were on, not a tab you land on.
 * The state lives above the navigator so the FAB and any screen's empty state
 * open the same one, and so the screen behind it stays visible underneath.
 */
export function QuickAddProvider({ children }: PropsWithChildren) {
  const [visible, setVisible] = useState(false);
  const api = useMemo<QuickAddApi>(
    () => ({ open: () => setVisible(true), close: () => setVisible(false) }),
    [],
  );

  return (
    <QuickAddContext.Provider value={api}>
      {children}
      <QuickAddSheet visible={visible} onClose={api.close} />
    </QuickAddContext.Provider>
  );
}

export function useQuickAdd(): QuickAddApi {
  const api = useContext(QuickAddContext);
  if (!api) throw new Error('useQuickAdd must be used inside a QuickAddProvider.');
  return api;
}

type Tile = {
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

const tiles: Tile[] = [
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
 * A 2×2 grid where Expense takes the whole top row. It is by far the most-used
 * action, and four identical buttons would make the user read all four every
 * time to find it.
 */
function QuickAddSheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const { space } = useTheme();

  const choose = useCallback(
    (route: string) => {
      if (Platform.OS !== 'web') void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      onClose();
      router.push(route as never);
    },
    [onClose],
  );

  return (
    <BottomSheet visible={visible} onClose={onClose} title="Add" doneLabel="Cancel">
      <View style={[styles.grid, { gap: space.md }]}>
        {tiles.map((tile) => (
          <QuickAddTile key={tile.route} tile={tile} onPress={() => choose(tile.route)} />
        ))}
      </View>
    </BottomSheet>
  );
}

function QuickAddTile({ tile, onPress }: { tile: Tile; onPress: () => void }) {
  const { palette, space, size, radius, motion } = useTheme();
  const toneColor = {
    negative: palette.negative,
    positive: palette.positive,
    neutral: palette.textSecondary,
    accent: palette.accent,
  }[tile.tone];

  // Only the two tiles that carry meaning beyond "another option" tint their
  // border: the primary action, and the one that is not really a spend.
  const tinted = tile.primary || tile.tone === 'accent';
  const chip = tile.primary ? size.touchTarget : size.buttonSmall;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={tile.title + '. ' + tile.description}
      onPress={onPress}
      style={({ pressed }) => [
        tile.primary || tile.horizontal ? styles.wide : styles.half,
        tile.horizontal && styles.horizontal,
        {
          borderRadius: radius.card,
          padding: tile.primary ? space.xl : space.lg + 2,
          gap: tile.horizontal ? space.md + 2 : space.md,
          backgroundColor: palette.canvas,
          borderWidth: StyleSheet.hairlineWidth,
          borderColor: tinted ? withAlpha(toneColor, 0.3) : palette.hairline,
        },
        pressed && { transform: [{ scale: motion.press.scale }] },
      ]}
    >
      <View
        style={[
          styles.chip,
          {
            width: chip,
            height: chip,
            borderRadius: chip / 3.4,
            backgroundColor: withAlpha(toneColor, 0.14),
          },
        ]}
      >
        <Icon name={tile.icon} size={tile.primary ? 22 : 20} color={toneColor} />
      </View>
      <View style={styles.label}>
        <Text variant={tile.primary ? 'subheading' : 'bodyStrong'}>{tile.title}</Text>
        <Text variant={tile.primary ? 'small' : 'caption'} tone="secondary">
          {tile.description}
        </Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  grid: { flexDirection: 'row', flexWrap: 'wrap' },
  wide: { width: '100%' },
  half: { flexGrow: 1, flexBasis: '46%' },
  horizontal: { flexDirection: 'row', alignItems: 'center' },
  chip: { alignItems: 'center', justifyContent: 'center' },
  label: { gap: 2 },
});
