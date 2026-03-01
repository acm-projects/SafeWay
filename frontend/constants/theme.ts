/**
 * Below are the colors that are used in the app. The colors are defined in the light and dark mode.
 * There are many other ways to style your app. For example, [Nativewind](https://www.nativewind.dev/), [Tamagui](https://tamagui.dev/), [unistyles](https://reactnativeunistyles.vercel.app), etc.
 */

import { Platform } from 'react-native';

const palette = {
  white: '#FCFCFC',
  rosewood: '#B56576',
  midnightViolet: '#230C33',
  teal: '#177E89',
  sunlitClay: '#F4B966',
};

export const Colors = {
  light: {
    text: palette.midnightViolet,
    background: palette.white,
    tint: palette.teal,
    icon: '#7A6B85',
    tabIconDefault: '#7A6B85',
    tabIconSelected: palette.teal,
  },
  dark: {
    text: palette.white,
    background: '#150B21',
    tint: palette.teal,
    icon: '#C8BACF',
    tabIconDefault: '#C8BACF',
    tabIconSelected: palette.sunlitClay,
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
