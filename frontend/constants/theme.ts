/**
 * Below are the colors that are used in the app. The colors are defined in the light and dark mode.
 * There are many other ways to style your app. For example, [Nativewind](https://www.nativewind.dev/), [Tamagui](https://tamagui.dev/), [unistyles](https://reactnativeunistyles.vercel.app), etc.
 */

import { Platform } from 'react-native';

export const palette = {
  white: '#FCFCFC',
  rosewood: '#B56576',
  midnightViolet: '#230C33',
  teal: '#177E89',
  sunlitClay: '#F4B966',
  deepPurple: '#0B1120',
  brightPurple: '#1ABC93',
  danger: '#E74C3C',
  royalBlue: '#3B82F6',
  mutedGray: '#7A8FA6',
  mediumPurple: '#8B5CF6',
  inputBg: '#1A2540',
  inputText: '#FFFFFF',
  navyBlue: '#141D2E',
  darkPurple: '#0B1120',
};

export const Glass = {
  light: {
    background: 'rgba(255,255,255,0.6)',
    backgroundStrong: 'rgba(255,255,255,0.85)',
    border: 'rgba(0,0,0,0.06)',
    borderStrong: 'rgba(0,0,0,0.12)',
    intensity: 40,
  },
  dark: {
    background: 'rgba(11,17,32,0.7)',
    backgroundStrong: 'rgba(11,17,32,0.9)',
    border: 'rgba(30,45,69,0.5)',
    borderStrong: 'rgba(30,45,69,0.8)',
    intensity: 60,
  },
};

export const Gradients = {
  primary: ['#0A9E6E', '#1ABC93', '#44D9B8'] as const,
  dark: ['#0B1120', '#141D2E'] as const,
  button: ['#0A9E6E', '#1ABC93', '#44D9B8'] as const,
};

export const Colors = {
  light: {
    text: palette.midnightViolet,
    background: palette.white,
    tint: palette.teal,
    icon: '#7A6B85',
    tabIconDefault: '#7A6B85',
    tabIconSelected: palette.teal,
    textSecondary: '#7A6B85',
    cardSolid: '#FFFFFF',
    divider: 'rgba(0,0,0,0.08)',
    inputBg: '#F0F0F0',
    inputText: palette.midnightViolet,
  },
  dark: {
    text: palette.white,
    background: '#0B1120',
    tint: palette.teal,
    icon: '#C8BACF',
    tabIconDefault: '#C8BACF',
    tabIconSelected: palette.sunlitClay,
    textSecondary: '#7A8FA6',
    cardSolid: '#141D2E',
    divider: '#1E2D45',
    inputBg: '#1A2540',
    inputText: '#FFFFFF',
  },
};

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
  },
  typography: {
    heading: 26,
    title: 20,
    body: 16,
    caption: 13,
  },
};

export const Fonts = Platform.select({
  ios: {
    /** iOS `UIFontDescriptorSystemDesignDefault` */
    sans: 'system-ui',
    /** iOS `UIFontDescriptorSystemDesignSerif` */
    serif: 'ui-serif',
    /** iOS `UIFontDescriptorSystemDesignRounded` */
    rounded: 'ui-rounded',
    /** iOS `UIFontDescriptorSystemDesignMonospaced` */
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
