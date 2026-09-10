/**
 * Category identity.
 *
 * The database has always stored an icon key on each category (`food`,
 * `groceries`, `fuel`…) that the old UI never rendered. This map gives each key
 * an icon and a hue so a category is recognisable at a glance rather than by
 * reading its name.
 *
 * Icon names are kebab-case strings rather than imported components so this
 * module stays free of UI dependencies; `components/ui/Icon` resolves them.
 *
 * These hues are for category identity only. They are not part of the palette
 * and must not be used for UI chrome — a category hue on a button would break
 * the one-accent rule. Their overlap with the semantic colours is harmless: a
 * green Family chip is clearly a badge, not a money figure, because of its shape
 * and position.
 */

export type CategoryIdentity = { icon: string; hue: string };

/** Keyed by the `icon` column on `categories`. */
export const categoryIdentity: Record<string, CategoryIdentity> = {
  // Expense
  food: { icon: 'utensils', hue: '#F4726A' },
  groceries: { icon: 'shopping-basket', hue: '#E8934B' },
  shopping: { icon: 'shopping-bag', hue: '#D97BB5' },
  travel: { icon: 'plane', hue: '#7AA2F7' },
  fuel: { icon: 'fuel', hue: '#E8B84B' },
  bills: { icon: 'receipt', hue: '#6FB3C4' },
  health: { icon: 'heart-pulse', hue: '#F06A8A' },
  entertainment: { icon: 'clapperboard', hue: '#A78BFA' },
  education: { icon: 'graduation-cap', hue: '#5B9BD5' },
  family: { icon: 'users', hue: '#5FD3A3' },
  gifts: { icon: 'gift', hue: '#EC7FA9' },

  // Income
  salary: { icon: 'wallet', hue: '#5FD3A3' },
  business: { icon: 'briefcase', hue: '#6FB3C4' },
  freelance: { icon: 'laptop', hue: '#7AA2F7' },
  interest: { icon: 'percent', hue: '#D8C08A' },
  bonus: { icon: 'sparkle', hue: '#E8B84B' },
  investment: { icon: 'trending-up', hue: '#5FD3A3' },

  /** Shared by both types, and identical either way. */
  other: { icon: 'circle-dashed', hue: '#98A1AE' },
};

/**
 * A category with no identity would render as a bare label next to twelve
 * decorated ones, which looks broken rather than plain. Custom categories the
 * user creates fall back here until they pick an icon and colour.
 */
export const fallbackCategoryIdentity: CategoryIdentity = {
  icon: 'circle-dashed',
  hue: '#98A1AE',
};

export function getCategoryIdentity(icon: string | null | undefined): CategoryIdentity {
  if (!icon) return fallbackCategoryIdentity;
  return categoryIdentity[icon] ?? fallbackCategoryIdentity;
}

/**
 * Account types are containers, not categories. They get monochrome icons and
 * no hue, so they never compete with the category system for attention.
 */
export const accountTypeIcon: Record<string, string> = {
  cash: 'banknote',
  bank: 'landmark',
  wallet: 'wallet',
  credit_card: 'credit-card',
  other: 'circle-dashed',
};

/** Confirmed against the design canvas. */
export const tabIcon = {
  index: 'house',
  transactions: 'arrow-left-right',
  add: 'plus',
  reports: 'chart-pie',
  more: 'menu',
} as const;
