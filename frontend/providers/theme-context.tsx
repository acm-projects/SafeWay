import { createContext, useContext, useState, ReactNode } from 'react';

// ─── Design tokens ────────────────────────────────────────────────────────────
// Previous navy theme (preserved for easy rollback):
// BG:        dark ? '#030427' : '#F2F4F8',
// CARD:      dark ? '#222344' : '#FFFFFF',
// ITEM:      dark ? '#2A2F5A' : '#EEF0F6',
// DIVIDER:   dark ? '#1E2D45' : '#E0E4EE',
// HANDLE:    dark ? '#2A3A55' : '#C8CEDD',
// ICON_BG:   dark ? '#1E2D45' : '#DDE0F0',
// ICON_FG:   dark ? '#1E3A8A' : '#5E5CE6',
// MAP_STYLE: dark ? 'dark' : 'light',
export function makeTokens(dark: boolean) {
  return {
    isDark:    dark,
    // BG:        dark ? '#000000' : '#F2F4F8',
    BG:        dark ? '#030427' : '#F2F4F8',
    // CARD:      dark ? '#1A1A1A' : '#FFFFFF',
    CARD:      dark ? '#222344' : '#FFFFFF',
    // ITEM:      dark ? '#242424' : '#EEF0F6',
    ITEM:      dark ? '#2A2F5A' : '#EEF0F6',
    GREEN:     '#1ABC93',
    PURPLE:    '#7C5CBF',
    ACCENT:    dark ? '#1ABC93' : '#5E5CE6',
    TEXT_PRI:  dark ? '#FFFFFF' : '#030427',
    TEXT_MUT:  dark ? '#7A8FA6' : '#8894A8',
    // DIVIDER:   dark ? '#2A2A2A' : '#E0E4EE',
    DIVIDER:   dark ? '#1E2D45' : '#E0E4EE',
    // HANDLE:    dark ? '#3A3A3A' : '#C8CEDD',
    HANDLE:    dark ? '#2A3A55' : '#C8CEDD',
    // ICON_BG:   dark ? '#2A2A2A' : '#DDE0F0',
    ICON_BG:   dark ? '#1E2D45' : '#DDE0F0',
    ICON_FG:   dark ? '#1E3A8A' : '#5E5CE6',
    AVATAR_BG: '#3A4A60',
    MAP_STYLE: dark ? 'light' as const : 'light' as const,
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
