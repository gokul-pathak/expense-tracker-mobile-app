import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PropsWithChildren,
} from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import Animated, { FadeInDown, FadeOutDown } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useTheme, withAlpha } from '@/theme';

import { Icon, type IconName } from './Icon';
import { Text } from './Text';

export type ToastTone = 'success' | 'error' | 'info';

export type ToastOptions = {
  message: string;
  tone?: ToastTone;
  action?: { label: string; onPress: () => void };
  /** Milliseconds before it dismisses itself. */
  duration?: number;
};

type ToastApi = { show: (options: ToastOptions) => void; hide: () => void };

const ToastContext = createContext<ToastApi | undefined>(undefined);
const DEFAULT_DURATION = 3500;

export function ToastProvider({ children }: PropsWithChildren) {
  const [current, setCurrent] = useState<(ToastOptions & { id: number }) | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const counter = useRef(0);

  const hide = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    setCurrent(null);
  }, []);

  const show = useCallback(
    (options: ToastOptions) => {
      if (timer.current) clearTimeout(timer.current);
      counter.current += 1;
      setCurrent({ ...options, id: counter.current });
      timer.current = setTimeout(hide, options.duration ?? DEFAULT_DURATION);
    },
    [hide],
  );

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  const api = useMemo(() => ({ show, hide }), [show, hide]);

  return (
    <ToastContext.Provider value={api}>
      {children}
      {current ? <ToastPill key={current.id} toast={current} onHide={hide} /> : null}
    </ToastContext.Provider>
  );
}

export function useToast(): ToastApi {
  const api = useContext(ToastContext);
  if (!api) throw new Error('useToast must be used inside a ToastProvider.');
  return api;
}

const toneIcon: Record<ToastTone, IconName> = {
  success: 'check',
  error: 'circle-alert',
  info: 'info',
};

/**
 * A floating pill above the tab bar. It is ink-on-paper in light mode and
 * raised-surface in dark, so it reads as a note laid on top of the page in
 * both. Auto-dismisses; the optional action is the only thing to tap.
 */
function ToastPill({ toast, onHide }: { toast: ToastOptions; onHide: () => void }) {
  const { palette, space, size, radius, elevation, motion, gutter } = useTheme();
  const insets = useSafeAreaInsets();
  const tone = toast.tone ?? 'success';
  const toneColor =
    tone === 'success' ? palette.positive : tone === 'error' ? palette.negative : palette.info;

  return (
    <Animated.View
      entering={FadeInDown.duration(motion.tabChange.duration)}
      exiting={FadeOutDown.duration(motion.tabChange.duration)}
      accessibilityLiveRegion="polite"
      pointerEvents="box-none"
      style={[
        styles.host,
        {
          left: gutter,
          right: gutter,
          bottom: insets.bottom + space.xl + size.tabBar + space.lg,
        },
      ]}
    >
      <View
        style={[
          styles.pill,
          elevation.sheet,
          {
            height: 54,
            borderRadius: radius.control + 2,
            backgroundColor: palette.toast.surface,
            borderColor: palette.toast.hairline,
            paddingHorizontal: space.lg + 2,
            gap: space.md,
          },
        ]}
      >
        <View
          style={[
            styles.icon,
            { borderRadius: space.sm, backgroundColor: withAlpha(toneColor, 0.16) },
          ]}
        >
          <Icon name={toneIcon[tone]} size="inline" color={toneColor} />
        </View>
        <Text
          variant="smallStrong"
          color={palette.toast.text}
          numberOfLines={1}
          style={styles.message}
        >
          {toast.message}
        </Text>
        {toast.action ? (
          <Pressable
            accessibilityRole="button"
            hitSlop={12}
            onPress={() => {
              toast.action?.onPress();
              onHide();
            }}
          >
            <Text variant="smallStrong" color={palette.toast.action}>
              {toast.action.label}
            </Text>
          </Pressable>
        ) : null}
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  host: { position: 'absolute', zIndex: 20 },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: StyleSheet.hairlineWidth,
  },
  icon: { width: 28, height: 28, alignItems: 'center', justifyContent: 'center' },
  message: { flex: 1 },
});
