/**
 * The Private Vault design system.
 *
 * Import visual values from here and nowhere else. The old `@/constants/theme`
 * still exists while 39 screens migrate off it — do not add new usages of it.
 *
 * The system is documented in `.claude/skills/private-vault-design/`.
 */

export { ThemeProvider, useTheme, type ThemePreference } from './ThemeProvider';
export { dark, light, type Elevation, type Palette } from './palettes';
export {
  accountTypeIcon,
  categoryIdentity,
  fallbackCategoryIdentity,
  getCategoryIdentity,
  tabIcon,
  type CategoryIdentity,
} from './categories';
export {
  backdrop,
  fonts,
  ICON_STROKE,
  iconSize,
  moneySize,
  motion,
  radius,
  SCREEN_GUTTER,
  space,
  type,
  type MoneySize,
  type TypeVariant,
} from './tokens';
