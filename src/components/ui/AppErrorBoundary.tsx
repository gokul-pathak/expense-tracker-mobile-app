import { Component, type ErrorInfo, type ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';

import { colors, spacing } from '@/constants/theme';

import { AppButton } from './AppButton';
import { AppText } from './AppText';

type Props = { children: ReactNode };
type State = { error: Error | null };

export class AppErrorBoundary extends Component<Props, State> {
  state: State = { error: null };
  static getDerivedStateFromError(error: Error): State {
    return { error };
  }
  componentDidCatch(error: Error, info: ErrorInfo) {
    if (__DEV__) console.error('Unhandled application render error.', error, info);
  }
  render() {
    if (!this.state.error) return this.props.children;
    return (
      <View style={styles.container} accessibilityRole="alert">
        <AppText variant="heading" weight="700">
          Something went wrong.
        </AppText>
        <AppText color={colors.textMuted}>Your financial data is still stored locally.</AppText>
        <AppButton label="Try Again" onPress={() => this.setState({ error: null })} />
      </View>
    );
  }
}
const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    gap: spacing.lg,
    padding: spacing.lg,
    backgroundColor: colors.background,
  },
});
