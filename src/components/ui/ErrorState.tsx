import { StyleSheet, View } from 'react-native';

import { useTheme } from '@/theme';

import { Button } from './Button';
import { Icon, type IconName } from './Icon';
import { Text } from './Text';

type Props = {
  title?: string;
  /** One plain sentence. */
  message: string;
  onRetry?: () => void;
  retryLabel?: string;
  icon?: IconName;
  fill?: boolean;
};

/** Muted icon, one plain sentence, a secondary "Try Again". */
export function ErrorState({
  title = "Couldn't load your data",
  message,
  onRetry,
  retryLabel = 'Try Again',
  icon = 'unplug',
  fill = true,
}: Props) {
  const { palette, space, radius } = useTheme();
  return (
    <View
      accessibilityRole="alert"
      accessibilityLiveRegion="polite"
      style={[styles.wrap, fill && styles.fill, { paddingVertical: space.xl5, gap: space.sm }]}
    >
      <View
        style={[
          styles.icon,
          {
            borderRadius: radius.card,
            backgroundColor: palette.surfaceRaised,
            borderColor: palette.hairline,
            marginBottom: space.md,
          },
        ]}
      >
        <Icon name={icon} size={32} color={palette.textTertiary} />
      </View>
      <Text variant="heading" align="center">
        {title}
      </Text>
      <Text variant="body" tone="secondary" align="center" style={styles.body}>
        {message}
      </Text>
      {onRetry ? (
        <View style={{ marginTop: space.lg }}>
          <Button
            label={retryLabel}
            variant="secondary"
            icon="rotate-cw"
            onPress={onRetry}
            fullWidth={false}
          />
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignItems: 'center', paddingHorizontal: 20 },
  fill: { flex: 1, justifyContent: 'center' },
  icon: {
    width: 72,
    height: 72,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: StyleSheet.hairlineWidth,
  },
  body: { maxWidth: 300 },
});
