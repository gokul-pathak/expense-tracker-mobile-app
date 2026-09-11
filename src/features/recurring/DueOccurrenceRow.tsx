import { StyleSheet, View } from 'react-native';

import { Banner, Button, CategoryChip, Money, Text } from '@/components/ui';
import { useTheme } from '@/theme';

import {
  describeBlockedOccurrence,
  dueLabel,
  formatScheduledShort,
  getDueAccessibilityLabel,
  getDueTimingLabel,
  getGenerateActionLabel,
  getSkipActionLabel,
  isOverdue,
  recurringTypeDirection,
  recurringTypeLabel,
} from './recurring-presentation';
import type { LocalDate } from './recurring-schedule';
import type { DueRecurringOccurrence } from './recurring.types';

type Props = {
  occurrence: DueRecurringOccurrence;
  asOfDate: LocalDate;
  /** A generate or skip is in flight for this row; its actions are disabled. */
  busy?: boolean;
  onGenerate: () => void;
  onSkip: () => void;
  /** Open the template to fix a blocked occurrence. */
  onEdit: () => void;
};

/**
 * One due date, with what it would record and the two decisions a person can
 * make about it: generate it, or skip it.
 *
 * A blocked date is never hidden and never silently skipped — it shows what is
 * wrong and offers to edit the template, and the skip remains so the date can be
 * set aside deliberately. The scheduled date is always shown, because a generated
 * transaction takes that date, not today's.
 */
export function DueOccurrenceRow({
  occurrence,
  asOfDate,
  busy = false,
  onGenerate,
  onSkip,
  onEdit,
}: Props) {
  const { space, size } = useTheme();
  const blocked = occurrence.blockedReason !== null;
  const overdue = isOverdue(occurrence.occurrenceDate, asOfDate);
  const secondary =
    recurringTypeLabel(occurrence.type) + ' · ' + formatScheduledShort(occurrence.occurrenceDate);

  return (
    <View style={{ gap: space.md }}>
      <View
        accessible
        accessibilityLabel={getDueAccessibilityLabel(occurrence, asOfDate)}
        style={[styles.head, { gap: space.md }]}
      >
        <CategoryChip categoryIcon={occurrence.categoryIcon} size={size.categoryChip} />
        <View style={styles.text}>
          <Text variant="bodyStrong" numberOfLines={1}>
            {dueLabel(occurrence)}
          </Text>
          <Text variant="caption" tone="tertiary" numberOfLines={1}>
            {secondary}
          </Text>
          <Text variant="caption" tone={overdue ? 'warning' : 'secondary'} numberOfLines={1}>
            {getDueTimingLabel(occurrence.occurrenceDate, asOfDate)}
          </Text>
        </View>
        <Money
          minorUnits={occurrence.amountMinor}
          currency={occurrence.currency}
          size="row"
          direction={recurringTypeDirection(occurrence.type)}
          showCode={false}
          align="right"
        />
      </View>

      {blocked && occurrence.blockedReason !== null ? (
        <>
          <Banner tone="warning" message={describeBlockedOccurrence(occurrence.blockedReason)} />
          <View style={[styles.actions, { gap: space.sm }]}>
            <View style={styles.action}>
              <Button label="Edit" variant="secondary" small disabled={busy} onPress={onEdit} />
            </View>
            <View style={styles.action}>
              <Button
                label="Skip"
                variant="text"
                small
                disabled={busy}
                onPress={onSkip}
                accessibilityLabel={getSkipActionLabel(occurrence)}
              />
            </View>
          </View>
        </>
      ) : (
        <View style={[styles.actions, { gap: space.sm }]}>
          <View style={styles.action}>
            <Button
              label="Generate"
              variant="primary"
              small
              loading={busy}
              disabled={busy}
              onPress={onGenerate}
              accessibilityLabel={getGenerateActionLabel(occurrence)}
            />
          </View>
          <View style={styles.action}>
            <Button
              label="Skip"
              variant="secondary"
              small
              disabled={busy}
              onPress={onSkip}
              accessibilityLabel={getSkipActionLabel(occurrence)}
            />
          </View>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  head: { flexDirection: 'row', alignItems: 'center' },
  text: { flex: 1, minWidth: 0, gap: 2 },
  actions: { flexDirection: 'row' },
  action: { flex: 1 },
});
