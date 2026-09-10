import type { ReactNode } from 'react';
import { View } from 'react-native';

import { useTheme } from '@/theme';

import { BottomSheet } from './BottomSheet';
import { Button } from './Button';
import { Card } from './Card';
import { Icon, type IconName } from './Icon';
import { ListRow } from './ListRow';
import { Text } from './Text';

export type PickerOption<T extends string | number = string | number> = {
  value: T;
  label: string;
  /** A second line: an account type, an outstanding balance. */
  detail?: string;
  icon?: IconName;
  iconColor?: string;
  /** Anything richer than an icon — a `CategoryChip`. */
  leading?: ReactNode;
};

type Props<T extends string | number> = {
  visible: boolean;
  onClose: () => void;
  title: string;
  options: PickerOption<T>[];
  selected?: T;
  onSelect: (value: T) => void;
  /** A row above the list that clears the choice: "None", "Any account". */
  clearOption?: { label: string; onSelect: () => void };
  /** Shown under the list — "Add Account", "Add Person". */
  footer?: { label: string; onPress: () => void };
  /** Shown instead of the list when there is nothing to choose from. */
  emptyMessage?: string;
};

/**
 * One list, one choice, sheet closes. Every picker in the app is this — the old
 * code hand-rolled four near-identical modals, which is how four subtly
 * different row heights and tick treatments got into one product.
 *
 * Choosing closes the sheet rather than requiring a Done, because a single
 * choice is complete the moment it is made.
 */
export function PickerSheet<T extends string | number>({
  visible,
  onClose,
  title,
  options,
  selected,
  onSelect,
  clearOption,
  footer,
  emptyMessage,
}: Props<T>) {
  const { palette, space } = useTheme();

  const tick = <Icon name="check" size="row" color={palette.accent} />;

  return (
    <BottomSheet scroll visible={visible} onClose={onClose} title={title}>
      {options.length === 0 && !clearOption ? (
        <Text variant="body" tone="secondary">
          {emptyMessage ?? 'There is nothing to choose from yet.'}
        </Text>
      ) : (
        <Card padding="none">
          {clearOption ? (
            <ListRow
              label={clearOption.label}
              chevron={false}
              trailing={selected === undefined ? tick : undefined}
              onPress={() => {
                clearOption.onSelect();
                onClose();
              }}
              last={options.length === 0}
            />
          ) : null}
          {options.map((option, index) => (
            <ListRow
              key={option.value}
              label={option.label}
              detail={option.detail}
              icon={option.icon}
              iconColor={option.iconColor}
              leading={option.leading}
              chevron={false}
              trailing={option.value === selected ? tick : undefined}
              onPress={() => {
                onSelect(option.value);
                onClose();
              }}
              last={index === options.length - 1}
            />
          ))}
        </Card>
      )}
      {footer ? (
        <View style={{ marginTop: space.lg }}>
          <Button label={footer.label} variant="secondary" icon="plus" onPress={footer.onPress} />
        </View>
      ) : null}
    </BottomSheet>
  );
}
