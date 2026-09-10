import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type PropsWithChildren,
} from 'react';
import { useColorScheme, type ColorSchemeName } from 'react-native';

import { dark, light, type Palette } from './palettes';
import {
  backdrop,
  fonts,
  iconSize,
  ICON_STROKE,
  moneySize,
  motion,
  radius,
  space,
  SCREEN_GUTTER,
  type,
} from './tokens';

/**
 * What the user chose, which is not the same as what is showing. `system` defers
 * to the OS, and is the default because a finance app that ignores the device's
 * appearance setting feels like it was ported from somewhere else.
 */
export type ThemePreference = 'system' | 'light' | 'dark';

type ThemeValue = {
  palette: Palette;
  /** The scheme actually rendering, after `system` is resolved. */
  scheme: 'dark' | 'light';
  preference: ThemePreference;
  setPreference: (next: ThemePreference) => void;

  space: typeof space;
  gutter: typeof SCREEN_GUTTER;
  radius: typeof radius;
  type: typeof type;
  fonts: typeof fonts;
  moneySize: typeof moneySize;
  motion: typeof motion;
  backdrop: typeof backdrop;
  iconSize: typeof iconSize;
  iconStroke: typeof ICON_STROKE;
  elevation: Palette['elevation'];
};

const ThemeContext = createContext<ThemeValue | undefined>(undefined);

/**
 * Dark is the primary theme, so anything the system does not resolve to a
 * definite scheme becomes dark. On a cold start `useColorScheme()` can return
 * null or `unspecified`, and flashing a light screen before settling on dark is
 * worse than the reverse.
 */
function resolveScheme(preference: ThemePreference, system: ColorSchemeName): 'dark' | 'light' {
  if (preference !== 'system') return preference;
  return system === 'light' ? 'light' : 'dark';
}

export function ThemeProvider({
  children,
  initialPreference = 'system',
}: PropsWithChildren<{ initialPreference?: ThemePreference }>) {
  const system = useColorScheme();
  const [preference, setPreferenceState] = useState<ThemePreference>(initialPreference);

  const setPreference = useCallback((next: ThemePreference) => {
    setPreferenceState(next);
    // Persistence is wired to the settings repository when the Settings screen
    // is rebuilt. Until then the choice lives for the session, which is enough
    // to develop and review both schemes.
  }, []);

  const value = useMemo<ThemeValue>(() => {
    const scheme = resolveScheme(preference, system);
    const palette = scheme === 'dark' ? dark : light;
    return {
      palette,
      scheme,
      preference,
      setPreference,
      space,
      gutter: SCREEN_GUTTER,
      radius,
      type,
      fonts,
      moneySize,
      motion,
      backdrop,
      iconSize,
      iconStroke: ICON_STROKE,
      elevation: palette.elevation,
    };
  }, [preference, setPreference, system]);

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

/**
 * The single entry point for every visual value. One call returns the resolved
 * palette alongside the static tokens, so a component never has to decide which
 * scheme is active or import a palette directly.
 */
export function useTheme(): ThemeValue {
  const value = useContext(ThemeContext);
  if (!value) {
    throw new Error('useTheme must be used inside a ThemeProvider.');
  }
  return value;
}
