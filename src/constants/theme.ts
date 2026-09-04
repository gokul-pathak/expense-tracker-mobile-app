export const colors = {
  background: '#F7F8FA',
  surface: '#FFFFFF',
  surfaceMuted: '#F0F2F5',
  text: '#17191C',
  textMuted: '#6E737A',
  border: '#E4E7EB',
  primary: '#246BFD',
  primaryPressed: '#1C56CC',
  success: '#16885B',
  danger: '#D83A52',
  shadow: '#000000',
} as const;

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
  xxxl: 48,
} as const;

export const radii = {
  sm: 8,
  md: 12,
  lg: 18,
  pill: 999,
} as const;

export const typography = {
  title: 30,
  heading: 22,
  subheading: 17,
  body: 16,
  caption: 13,
  tab: 11,
} as const;

export const shadows = {
  card: {
    shadowColor: colors.shadow,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 8,
    elevation: 2,
  },
} as const;
