'use client';

import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';

export type Theme = 'light' | 'dark' | 'system';
type ActualTheme = 'light' | 'dark';

interface ThemeContextType {
  theme: Theme;
  setTheme: (theme: Theme) => void;
  actualTheme: ActualTheme;
}

const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

export function useTheme(): ThemeContextType {
  const context = useContext(ThemeContext);
  if (!context) throw new Error('useTheme must be used within a ThemeProvider');
  return context;
}

function readSavedTheme(): Theme {
  if (typeof window === 'undefined') return 'system';
  const value = window.localStorage.getItem('theme');
  return value === 'light' || value === 'dark' || value === 'system' ? value : 'system';
}

function resolveTheme(theme: Theme): ActualTheme {
  if (theme !== 'system') return theme;
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

export function ThemeProvider({ children }: { children: React.ReactNode }): React.ReactElement {
  const [theme, setThemeState] = useState<Theme>('system');
  const [actualTheme, setActualTheme] = useState<ActualTheme>('light');

  useEffect(() => {
    setThemeState(readSavedTheme());
  }, []);

  useEffect(() => {
    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    const applyTheme = () => {
      const resolved = resolveTheme(theme);
      setActualTheme(resolved);
      document.documentElement.classList.toggle('dark', resolved === 'dark');
      document.documentElement.classList.toggle('light', resolved === 'light');
      document.documentElement.style.colorScheme = resolved;
    };

    applyTheme();
    mediaQuery.addEventListener('change', applyTheme);
    return () => mediaQuery.removeEventListener('change', applyTheme);
  }, [theme]);

  const setTheme = useCallback((nextTheme: Theme) => {
    setThemeState(nextTheme);
    window.localStorage.setItem('theme', nextTheme);
  }, []);

  const value = useMemo(
    () => ({ theme, setTheme, actualTheme }),
    [theme, setTheme, actualTheme]
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}
