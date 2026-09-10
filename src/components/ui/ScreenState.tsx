import { StyleSheet, View } from 'react-native';

import { useTheme } from '@/theme';

import { Button } from './Button';
import { Text } from './Text';

type Props = { title: string; description: string; retry?: () => void; retryLabel?: string };

/**
 * A short inline status inside a screen that is otherwise fine: a section that
 * could not load, a notice. Full-screen states use `EmptyState`, `ErrorState`
 * and `Skeleton`.
 */
export function ScreenState({ title, description, retry, retryLabel = 'Try Again' }: Props) {
  const { space } = useTheme();
  return (
    <View
      style={[styles.container, { gap: space.md, paddingVertical: space.xxl }]}
      accessibilityRole="alert"
      accessibilityLiveRegion="polite"
    >
      <Text variant="subheading">{title}</Text>
      <Text variant="body" tone="secondary">
        {description}
      </Text>
      {retry ? (
        <Button label={retryLabel} onPress={retry} variant="secondary" fullWidth={false} />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { alignItems: 'flex-start' },
});
