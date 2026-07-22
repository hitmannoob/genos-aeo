'use client'
import React from 'react';
import { Sun, Moon, Monitor } from 'lucide-react';
import { useTheme } from '@/context/ThemeContext';

export default function ThemeToggle(): React.ReactElement {
  const { theme, setTheme } = useTheme();

  const themeOptions = [
    { value: 'light', label: 'Light', icon: Sun },
    { value: 'dark', label: 'Dark', icon: Moon },
    { value: 'system', label: 'System', icon: Monitor },
  ] as const;

  return (
    <div className="relative">
      <select
        aria-label="Color theme"
        value={theme}
        onChange={(e) => setTheme(e.target.value as 'light' | 'dark' | 'system')}
        className="appearance-none bg-background border border-border rounded-lg px-3 py-2 pr-8 text-foreground hover:bg-accent transition-colors"
      >
        {themeOptions.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      
      <div className="absolute inset-y-0 right-0 flex items-center pr-3 pointer-events-none">
        {themeOptions.map((option) => {
          if (option.value === theme) {
            const Icon = option.icon;
            return (
              <Icon 
                key={option.value} 
                className="h-4 w-4 text-foreground" 
              />
            );
          }
          return null;
        })}
      </div>
    </div>
  );
}
