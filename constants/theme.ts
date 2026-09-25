import { Platform } from 'react-native';

export type ThemeMode = 'dark' | 'light';

const darkTheme = {
  background: '#0A0E17',
  backgroundSecondary: '#0F1420',
  surface: '#151C2C',
  surfaceElevated: '#1C2438',
  primary: '#3B82F6',
  primaryLight: '#60A5FA',
  primaryDark: '#2563EB',
  bullish: '#10B981',
  bullishLight: '#34D399',
  bullishBg: 'rgba(16, 185, 129, 0.12)',
  bearish: '#EF4444',
  bearishLight: '#F87171',
  bearishBg: 'rgba(239, 68, 68, 0.12)',
  neutral: '#F59E0B',
  neutralLight: '#FBBF24',
  neutralBg: 'rgba(245, 158, 11, 0.12)',
  textPrimary: '#FFFFFF',
  textSecondary: '#9CA3AF',
  textTertiary: '#6B7280',
  border: '#1F2937',
  borderLight: '#374151',
  success: '#10B981',
  error: '#EF4444',
  warning: '#F59E0B',
  // Premium accent tokens for Pro/luxury elements
  gold: '#FFD700',
  goldLight: '#FBBF24',
  goldDark: '#D97706',
  goldBg: 'rgba(255, 215, 0, 0.12)',
};

const lightTheme = {
  background: '#F8F9FB',
  backgroundSecondary: '#FFFFFF',
  surface: '#FFFFFF',
  surfaceElevated: '#F1F3F5',
  primary: '#2563EB',
  primaryLight: '#3B82F6',
  primaryDark: '#1D4ED8',
  bullish: '#059669',
  bullishLight: '#10B981',
  bullishBg: 'rgba(5, 150, 105, 0.10)',
  bearish: '#DC2626',
  bearishLight: '#EF4444',
  bearishBg: 'rgba(220, 38, 38, 0.10)',
  neutral: '#D97706',
  neutralLight: '#F59E0B',
  neutralBg: 'rgba(217, 119, 6, 0.10)',
  textPrimary: '#111827',
  textSecondary: '#6B7280',
  textTertiary: '#9CA3AF',
  border: '#E5E7EB',
  borderLight: '#D1D5DB',
  success: '#059669',
  error: '#DC2626',
  warning: '#D97706',
  // Premium accent tokens for Pro/luxury elements
  gold: '#D97706',
  goldLight: '#F59E0B',
  goldDark: '#92400E',
  goldBg: 'rgba(217, 119, 6, 0.10)',
};

export function getTheme(mode: ThemeMode) {
  const colors = mode === 'dark' ? darkTheme : lightTheme;
  return {
    ...colors,
    spacing: { xs: 4, sm: 8, md: 12, lg: 16, xl: 20, xxl: 24, xxxl: 32 },
    radius: { sm: 8, md: 12, lg: 16, xl: 20, full: 9999 },
    shadow: Platform.select({
      ios: { shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: mode === 'dark' ? 0.25 : 0.10, shadowRadius: 8 },
      android: { elevation: 4 },
      default: {},
    }),
    shadowLight: Platform.select({
      ios: { shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: mode === 'dark' ? 0.15 : 0.06, shadowRadius: 4 },
      android: { elevation: 2 },
      default: {},
    }),
    // Premium elevated shadow for hero cards / feature highlights
    shadowPremium: Platform.select({
      ios: { shadowColor: mode === 'dark' ? '#3B82F6' : '#000', shadowOffset: { width: 0, height: 8 }, shadowOpacity: mode === 'dark' ? 0.30 : 0.15, shadowRadius: 18 },
      android: { elevation: 10 },
      default: {},
    }),
  };
}

// Default export for backward compat - will be overridden by context
export const theme = getTheme('dark');

export function getTypography(t: typeof theme) {
  return {
    heroPrice: { fontSize: 48, fontWeight: '700' as const, color: t.textPrimary, letterSpacing: -1 },
    heroLabel: { fontSize: 11, fontWeight: '600' as const, color: t.textTertiary, textTransform: 'uppercase' as const, letterSpacing: 1 },
    h1: { fontSize: 28, fontWeight: '700' as const, color: t.textPrimary },
    h2: { fontSize: 24, fontWeight: '700' as const, color: t.textPrimary },
    h3: { fontSize: 18, fontWeight: '600' as const, color: t.textPrimary },
    dataLarge: { fontSize: 32, fontWeight: '700' as const, color: t.textPrimary },
    dataMedium: { fontSize: 24, fontWeight: '700' as const, color: t.textPrimary },
    dataSmall: { fontSize: 16, fontWeight: '600' as const, color: t.textPrimary },
    body: { fontSize: 15, fontWeight: '400' as const, color: t.textPrimary },
    bodySmall: { fontSize: 13, fontWeight: '400' as const, color: t.textSecondary },
    label: { fontSize: 14, fontWeight: '600' as const, color: t.textSecondary },
    caption: { fontSize: 12, fontWeight: '500' as const, color: t.textTertiary },
    overline: { fontSize: 11, fontWeight: '600' as const, color: t.textTertiary, textTransform: 'uppercase' as const, letterSpacing: 1 },
    ticker: { fontSize: 16, fontWeight: '700' as const, color: t.textPrimary, letterSpacing: 0.5 },
    tickerSmall: { fontSize: 14, fontWeight: '600' as const, color: t.textPrimary },
  };
}

export const typography = getTypography(theme);
