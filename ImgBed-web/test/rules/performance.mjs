/**
 * P 类规则: Performance — 性能优化建议
 * P01-P03
 */
import { matchAllWithLines } from '../lib/assert.mjs';
import {
  INFINITE_SCROLL_HINT_KEYWORDS,
  INLINE_HANDLER_WARNING_THRESHOLD,
  MEMO_LOOKBACK_LINES,
  PERFORMANCE_COMPONENT_EXTENSIONS,
} from '../config/performance-config.mjs';

// P01: JSX 内联箭头函数（汇总统计）
const P01 = {
  code: 'P01',
  name: '内联箭头函数',
  category: 'performance',
  severity: 'info',
  description: 'JSX 事件属性中的内联箭头函数在每次渲染时创建新引用',
  check(file, reporter) {
    if (!PERFORMANCE_COMPONENT_EXTENSIONS.some(ext => file.filePath.endsWith(ext))) return;

    // 匹配 onXxx={() => ...} 或 onXxx={(e) => ...}
    const pattern = /\bon[A-Z]\w+=\{\s*(?:\([^)]*\))?\s*=>/g;
    const hits = matchAllWithLines(file.content, pattern);

    if (hits.length > INLINE_HANDLER_WARNING_THRESHOLD) {
      // 汇总报告，不逐条列出
      reporter.add({
        file: file.relativePath,
        line: 1,
        col: 0,
        rule: 'P01',
        severity: 'info',
        message: `文件内有 ${hits.length} 处 JSX 内联箭头函数，高频渲染组件建议提取为 useCallback`,
      });
    }
  },
};

// P02: 大列表未使用虚拟化
const P02 = {
  code: 'P02',
  name: '大列表虚拟化',
  category: 'performance',
  severity: 'info',
  description: '含分页/无限滚动的列表建议评估虚拟化方案',
  check(file, reporter) {
    if (!PERFORMANCE_COMPONENT_EXTENSIONS.some(ext => file.filePath.endsWith(ext))) return;

    // 启发式：同时存在 .map( 和 hasMore/sentinel 相关标识
    const hasMap = /\.map\s*\(/.test(file.content);
    const hasInfiniteScroll = new RegExp(INFINITE_SCROLL_HINT_KEYWORDS.join('|'), 'i').test(file.content);

    if (hasMap && hasInfiniteScroll) {
      reporter.add({
        file: file.relativePath,
        line: 1,
        col: 0,
        rule: 'P02',
        severity: 'info',
        message: '含无限滚动列表 -- 数据量较大时建议评估 react-window/react-virtuoso 虚拟化方案',
      });
    }
  },
};

// P03: 链式计算未 memo 化
const P03 = {
  code: 'P03',
  name: '未 memo 的链式计算',
  category: 'performance',
  severity: 'info',
  description: '渲染函数中的 .filter().map() 等链式调用建议 useMemo 缓存',
  check(file, reporter) {
    if (!PERFORMANCE_COMPONENT_EXTENSIONS.some(ext => file.filePath.endsWith(ext))) return;

    // 检测 return 块中的 .filter(.map( 链
    const pattern = /\.filter\s*\([^)]*\)\s*\.map\s*\(/g;
    const hits = matchAllWithLines(file.content, pattern);

    for (const hit of hits) {
      // 检查前面是否已被 useMemo 包裹（简易检测：前 5 行内有 useMemo）
      const startLine = Math.max(0, hit.line - (MEMO_LOOKBACK_LINES + 1));
      let isMemoized = false;
      for (let i = startLine; i < hit.line; i++) {
        if (/useMemo\s*\(/.test(file.lines[i] || '')) {
          isMemoized = true;
          break;
        }
      }
      if (!isMemoized) {
        reporter.add({
          file: file.relativePath,
          line: hit.line,
          col: hit.col,
          rule: 'P03',
          severity: 'info',
          message: '.filter().map() 链式计算未被 useMemo 缓存 -- 数据量大时建议优化',
        });
      }
    }
  },
};

export default [P01, P02, P03];
