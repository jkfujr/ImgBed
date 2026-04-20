import { createContext, useContext } from 'react';

export const ThemeContext = createContext(null);

/**
 * 使用主题上下文的 Hook
 */
export function useThemeMode() {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error('useThemeMode 必须在 ThemeProvider 内部使用');
  }
  return context;
}
