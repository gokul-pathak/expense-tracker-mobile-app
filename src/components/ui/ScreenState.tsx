import { StyleSheet, View } from 'react-native';

import { colors, spacing } from '@/constants/theme';

import { AppButton } from './AppButton';
import { AppText } from './AppText';

type Props = { title: string; description: string; retry?: () => void };

export function ScreenState({ title, description, retry }: Props) {
  return (
    <View style={styles.container}>
      <AppText variant="subheading" weight="700">
        {title}
      </AppText>
      <AppText color={colors.textMuted} style={styles.description}>
        {description}
      </AppText>
      {retry ? <AppButton label="Try Again" onPress={retry} variant="secondary" /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { gap: spacing.md, paddingVertical: spacing.xxl },
  description: { lineHeight: 22 },
});
