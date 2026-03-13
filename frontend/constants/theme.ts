import { Platform } from 'react-native';

// ─── Core Palette ────────────────────────────────────────────────────────────
export const palette = {
  // Purples
  deepPurple: '#1A0A2E',
  darkPurple: '#2D1B4E',
  mediumPurple: '#6C3FA0',
  brightPurple: '#8B5CF6',
  lightPurple: '#A78BFA',
  palePurple: '#C4B5FD',

  // Blues
  deepBlue: '#0F1B3D',
  navyBlue: '#1E3A5F',
  royalBlue: '#3B82F6',
  lightBlue: '#60A5FA',

  // Teals
  teal: '#14B8A6',
  cyan: '#22D3EE',
  mintTeal: '#5EEAD4',

  // Neutrals
  white: '#FCFCFC',
  offWhite: '#F8F7FF',
  lightGray: '#E8E5F0',
  mutedGray: '#8B8BA3',
  darkGray: '#4A4A6A',

  // Semantic
  danger: '#EF4444',
  warning: '#F59E0B',
  success: '#14B8A6',
};

// ─── Light / Dark Color Tokens ───────────────────────────────────────────────
export const Colors = {
  light: {
    text: '#1A0A2E',
    textSecondary: '#6B7280',
    background: palette.offWhite,
    card: 'rgba(255, 255, 255, 0.75)',
    cardSolid: '#FFFFFF',
    tint: palette.brightPurple,
    icon: '#6B7280',
    tabIconDefault: '#8B8BA3',
    tabIconSelected: palette.brightPurple,
    border: 'rgba(0, 0, 0, 0.06)',
    divider: '#E5E7EB',
    inputBg: '#F0EDFF',
    inputText: '#1A0A2E',
    mapOverlay: 'rgba(255, 255, 255, 0.85)',
  },
  dark: {
    text: '#FFFFFF',
    textSecondary: '#8B8BA3',
    background: palette.deepPurple,
    card: 'rgba(45, 27, 78, 0.6)',
    cardSolid: '#2D1B4E',
    tint: palette.brightPurple,
    icon: '#A78BFA',
    tabIconDefault: '#8B8BA3',
    tabIconSelected: palette.brightPurple,
    border: 'rgba(255, 255, 255, 0.08)',
    divider: 'rgba(255, 255, 255, 0.08)',
    inputBg: 'rgba(45, 27, 78, 0.5)',
    inputText: '#FFFFFF',
    mapOverlay: 'rgba(26, 10, 46, 0.85)',
  },
};

// ─── Gradient Presets ────────────────────────────────────────────────────────
export const Gradients = {
  primary: ['#6C3FA0', '#8B5CF6', '#3B82F6'] as const,
  landing: ['#0D0519', '#1A0A2E', '#2D1B4E'] as const,
  button: ['#8B5CF6', '#3B82F6'] as const, // purple to light blue, matches navbar
  buttonAlt: ['#14B8A6', '#22D3EE'] as const,
  teal: ['#14B8A6', '#22D3EE'] as const,
  card: ['rgba(139, 92, 246, 0.15)', 'rgba(59, 130, 246, 0.08)'] as const,
  purpleFade: ['#2D1B4E', '#1A0A2E'] as const,
};

// ─── Glassmorphism Tokens ────────────────────────────────────────────────────
export const Glass = {
  dark: {
    background: 'rgba(45, 27, 78, 0.55)',
    backgroundStrong: 'rgba(45, 27, 78, 0.75)',
    border: 'rgba(255, 255, 255, 0.1)',
    borderStrong: 'rgba(255, 255, 255, 0.18)',
    intensity: 40,
  },
  light: {
    background: 'rgba(255, 255, 255, 0.65)',
    backgroundStrong: 'rgba(255, 255, 255, 0.8)',
    border: 'rgba(255, 255, 255, 0.4)',
    borderStrong: 'rgba(0, 0, 0, 0.06)',
    intensity: 50,
  },
};

// ─── Map Styles ──────────────────────────────────────────────────────────────
export const MapStyles = {
  dark: [
    { elementType: 'geometry', stylers: [{ color: '#1A0A2E' }] },
    { elementType: 'labels.text.fill', stylers: [{ color: '#8B8BA3' }] },
    { elementType: 'labels.text.stroke', stylers: [{ color: '#1A0A2E' }] },
    { featureType: 'road', elementType: 'geometry', stylers: [{ color: '#2D1B4E' }] },
    { featureType: 'road', elementType: 'geometry.stroke', stylers: [{ color: '#1A0A2E' }] },
    { featureType: 'road.highway', elementType: 'geometry', stylers: [{ color: '#3D2566' }] },
    { featureType: 'water', elementType: 'geometry', stylers: [{ color: '#0F1B3D' }] },
    { featureType: 'landscape', elementType: 'geometry', stylers: [{ color: '#1A0A2E' }] },
    { featureType: 'poi', elementType: 'geometry', stylers: [{ color: '#2D1B4E' }] },
    { featureType: 'poi.park', elementType: 'geometry', stylers: [{ color: '#1A2540' }] },
    { featureType: 'transit', elementType: 'geometry', stylers: [{ color: '#2D1B4E' }] },
  ],
  light: [] as any[], // empty = default Google Maps light style
};

// ─── Spacing / Radius / Typography ──────────────────────────────────────────
export const AppTheme = {
  palette,
  spacing: {
    xs: 4,
    sm: 8,
    md: 12,
    lg: 16,
    xl: 20,
    xxl: 28,
  },
  radius: {
    sm: 8,
    md: 12,
    lg: 16,
    xl: 24,
    xxl: 32,
  },
  typography: {
    heading: 26,
    title: 20,
    body: 16,
    caption: 13,
    small: 11,
  },
};

export const Fonts = Platform.select({
  ios: {
    sans: 'system-ui',
    serif: 'ui-serif',
    rounded: 'ui-rounded',
    mono: 'ui-monospace',
  },
  default: {
    sans: 'normal',
    serif: 'serif',
    rounded: 'normal',
    mono: 'monospace',
  },
  web: {
    sans: "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
    serif: "Georgia, 'Times New Roman', serif",
    rounded: "'SF Pro Rounded', 'Hiragino Maru Gothic ProN', Meiryo, 'MS PGothic', sans-serif",
    mono: "SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace",
  },
});
