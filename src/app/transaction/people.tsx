import { router } from 'expo-router';
import { Pressable, StyleSheet, View } from 'react-native';

import { FormScreen, Icon, NativeDataNotice, Screen, Text, type IconName } from '@/components/ui';
import { isLocalFinanceDataAvailable } from '@/features/ui/data';
import { useTheme, withAlpha } from '@/theme';

type Choice = {
  route: string;
  icon: IconName;
  title: string;
  description: string;
  tone: 'accent' | 'info';
};

const choices: Choice[] = [
  {
    route: '/transaction/lend/new',
    icon: 'hand-coins',
    title: 'Money I Gave',
    description: 'You lent money to someone. It stays on your books as money owed to you.',
    tone: 'accent',
  },
  {
    route: '/transaction/borrow/new',
    icon: 'hand-helping',
    title: 'Money I Took',
    description: 'Someone lent money to you. It stays on your books as money you owe.',
    tone: 'info',
  },
];

/**
 * Lending within a family or a circle of friends is a first-class part of how
 * money works here, so this gets its own screen rather than a segment on a
 * form. Two cards, each stating plainly what it does to your books.
 */
export default function LendBorrowChooserScreen() {
  const { space } = useTheme();

  if (!isLocalFinanceDataAvailable) {
    return (
      <Screen>
        <NativeDataNotice />
      </Screen>
    );
  }

  return (
    <FormScreen title="Money with People" backIcon="arrow-left">
      <Text variant="body" tone="secondary" style={{ marginTop: space.sm }}>
        Record money that moved between you and someone else. Neither side counts as spending or
        earning.
      </Text>
      <View style={{ marginTop: space.xl, gap: space.md }}>
        {choices.map((choice) => (
          <ChoiceCard key={choice.route} choice={choice} />
        ))}
      </View>
    </FormScreen>
  );
}

function ChoiceCard({ choice }: { choice: Choice }) {
  const { palette, space, size, radius, motion } = useTheme();
  const hue = choice.tone === 'accent' ? palette.accent : palette.info;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={choice.title + '. ' + choice.description}
      onPress={() => router.push(choice.route as never)}
      style={({ pressed }) => [
        {
          borderRadius: radius.card,
          padding: space.xl,
          gap: space.md + 2,
          backgroundColor: palette.surface,
          borderWidth: StyleSheet.hairlineWidth,
          borderColor: withAlpha(hue, 0.28),
        },
        pressed && { transform: [{ scale: motion.press.scale }] },
      ]}
    >
      <View style={styles.head}>
        <View
          style={[
            styles.chip,
            {
              width: size.touchTarget,
              height: size.touchTarget,
              borderRadius: radius.control - 1,
              backgroundColor: withAlpha(hue, 0.14),
            },
          ]}
        >
          <Icon name={choice.icon} size={22} color={hue} />
        </View>
        <Icon name="arrow-right" size={20} color={palette.textTertiary} />
      </View>
      <View style={{ gap: space.xs - 1 }}>
        <Text variant="heading">{choice.title}</Text>
        <Text variant="small" tone="secondary">
          {choice.description}
        </Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  chip: { alignItems: 'center', justifyContent: 'center' },
});
