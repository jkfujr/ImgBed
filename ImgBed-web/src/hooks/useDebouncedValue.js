import { useState, useEffect, useRef } from 'react';

/**
 * 防抖值 Hook - 输入值变化后延迟一定时间才更新输出值
 * @param {any} value 输入值
 * @param {number} delay 延迟毫秒，默认 300ms
 * @returns {any} 防抖后的输出值
 *
 * 使用示例:
 * const searchDebounced = useDebouncedValue(searchInput, 300);
 */
export function useDebouncedValue(value, delay = 300) {
  const [debounced, setDebounced] = useState(value);
  const timeoutRef = useRef(null);

  useEffect(() => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
    }
    timeoutRef.current = setTimeout(() => {
      setDebounced(value);
    }, delay);

    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, [value, delay]);

  return debounced;
}
