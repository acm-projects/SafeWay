import { createContext, useContext, useState, ReactNode } from 'react';

// ─── Design tokens ────────────────────────────────────────────────────────────
export function makeTokens(dark: boolean) {
  return {
    isDark:    dark,
    BG:        dark ? '#030427' : '#F2F4F8',
    CARD:      dark ? '#222344' : '#FFFFFF',
    ITEM:      dark ? '#2A2F5A' : '#EEF0F6',
    GREEN:     '#1ABC93',
    PURPLE:    '#7C5CBF',
    // ACCENT = teal in dark mode, purple in light mode
    ACCENT:    dark ? '#1ABC93' : '#7C5CBF',
    TEXT_PRI:  dark ? '#FFFFFF' : '#030427',
    TEXT_MUT:  dark ? '#7A8FA6' : '#8894A8',
    DIVIDER:   dark ? '#1E2D45' : '#E0E4EE',
    HANDLE:    dark ? '#2A3A55' : '#C8CEDD',
    ICON_BG:   dark ? '#1E2D45' : '#DDE0F0',
    ICON_FG:   dark ? '#1E3A8A' : '#5E5CE6',
    AVATAR_BG: '#3A4A60', // always gray
    MAP_STYLE: dark ? 'dark' : 'light',
  };
}

export type Tokens = ReturnType<typeof makeTokens>;

interface ThemeCtx {
  isDark: boolean;
  T: Tokens;
  toggleTheme: () => void;
}

const ThemeContext = createContext<ThemeCtx>({
  isDark: true,
  T: makeTokens(true),
  toggleTheme: () => {},
});

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [isDark, setIsDark] = useState(true);
  const T = makeTokens(isDark);
  return (
    <ThemeContext.Provider value={{ isDark, T, toggleTheme: () => setIsDark(d => !d) }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  return useContext(ThemeContext);
}