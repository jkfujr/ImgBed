import { useMemo } from 'react';
import { useUserPreference } from '../hooks/useUserPreference';
import { ThemeContext } from '../hooks/useThemeMode';

/**
 * 主题模式提供者
 * 支持三种模式: light(亮色) / dark(暗色) / auto(跟随系统)
 */
export function ThemeProvider({ children }) {
  const [themeMode, setThemeMode] = useUserPreference('pref_theme_mode', 'auto');

  // 计算实际使用的主题模式
  const actualMode = useMemo(() => {
    if (themeMode === 'auto') {
      // 检测系统主题偏好
      if (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) {
        return 'dark';
      }
      return 'light';
    }
    return themeMode;
  }, [themeMode]);

  const value = useMemo(() => ({
    themeMode,        // 用户选择的模式 (light/dark/auto)
    actualMode,       // 实际应用的模式 (light/dark)
    setThemeMode,     // 切换主题模式
  }), [themeMode, actualMode, setThemeMode]);

  return (
    <ThemeContext.Provider value={value}>
      {children}
    </ThemeContext.Provider>
  );
}
