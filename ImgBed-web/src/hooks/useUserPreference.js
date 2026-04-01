import { useState, useEffect } from 'react';

/**
 * 用户偏好 Hook - 自动持久化到 localStorage
 * @param {string} key localStorage 键名
 * @param {any} defaultValue 默认值
 * @returns {[any, function]} [value, setValue] 类似 useState
 *
 * 示例:
 * const [cols, setCols] = useUserPreference('pref_masonry_cols', '0');
 */
export function useUserPreference(key, defaultValue) {
  // 初始值从 localStorage 读取
  const [value, setValue] = useState(() => {
    const stored = localStorage.getItem(key);
    if (stored === null) return defaultValue;
    // 尝试解析 JSON，如果失败返回原始字符串
    try {
      return JSON.parse(stored);
    } catch {
      return stored;
    }
  });

  // 值变化时自动保存
  useEffect(() => {
    if (value === undefined) {
      localStorage.removeItem(key);
    } else {
      localStorage.setItem(key, JSON.stringify(value));
    }
  }, [key, value]);

  return [value, setValue];
}
