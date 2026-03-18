/**
 * Theme Toggle Component
 * Allows users to switch between light, dark, and system themes
 */

import { Sun, Moon, Monitor } from 'lucide-react';
import { clsx } from 'clsx';
import { useTheme, Theme } from '../hooks/useTheme';

interface ThemeToggleProps {
  showLabel?: boolean;
  showSystem?: boolean;
  className?: string;
}

export default function ThemeToggle({ 
  showLabel = false, 
  showSystem = true,
  className 
}: ThemeToggleProps) {
  const { theme, resolvedTheme, setTheme, toggleTheme } = useTheme();

  const themes: { value: Theme; icon: typeof Sun; label: string }[] = [
    { value: 'light', icon: Sun, label: 'Light' },
    { value: 'dark', icon: Moon, label: 'Dark' },
  ];

  if (showSystem) {
    themes.push({ value: 'system', icon: Monitor, label: 'System' });
  }

  // Simple toggle button (no dropdown)
  if (!showLabel && !showSystem) {
    return (
      <button
        onClick={toggleTheme}
        className={clsx(
          'rounded-lg p-2 transition-colors',
          'bg-zinc-100 hover:bg-zinc-200 dark:bg-zinc-800 dark:hover:bg-zinc-700',
          'text-zinc-600 dark:text-zinc-300',
          className
        )}
        title={resolvedTheme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
      >
        {resolvedTheme === 'dark' ? (
          <Sun className="h-5 w-5" />
        ) : (
          <Moon className="h-5 w-5" />
        )}
      </button>
    );
  }

  // Full toggle with options
  return (
    <div className={clsx('flex items-center gap-1 rounded-lg bg-zinc-100 p-1 dark:bg-zinc-800', className)}>
      {themes.map(({ value, icon: Icon, label }) => (
        <button
          key={value}
          onClick={() => setTheme(value)}
          className={clsx(
            'flex items-center gap-2 rounded-md px-3 py-1.5 text-sm font-medium transition-colors',
            theme === value
              ? 'bg-white text-zinc-900 shadow-sm dark:bg-zinc-700 dark:text-white'
              : 'text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-white'
          )}
          title={label}
        >
          <Icon className="h-4 w-4" />
          {showLabel && <span>{label}</span>}
        </button>
      ))}
    </div>
  );
}
