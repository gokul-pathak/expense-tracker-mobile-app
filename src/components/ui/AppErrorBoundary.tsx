import { Component, type ErrorInfo, type ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';

import { useTheme } from '@/theme';

import { ErrorState } from './ErrorState';

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
    return <Fallback onRetry={() => this.setState({ error: null })} />;
  }
}

function Fallback({ onRetry }: { onRetry: () => void }) {
  const { palette, gutter } = useTheme();
  return (
    <View style={[styles.fill, { backgroundColor: palette.canvas, paddingHorizontal: gutter }]}>
      <ErrorState
        title="Something went wrong"
        message="Your financial data is still stored on this device."
        onRetry={onRetry}
      />
    </View>
  );
}

const styles = StyleSheet.create({ fill: { flex: 1 } });
