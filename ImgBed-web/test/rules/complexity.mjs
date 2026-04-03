/**
 * C 类规则: Complexity — 复杂度分析
 * C01-C04
 * 整合自 analyze-component-complexity.mjs
 */
import {
  COMPLEXITY_SCORE_THRESHOLDS,
  COMPLEXITY_SCORE_WEIGHTS,
  FILE_LINE_THRESHOLDS,
  USE_EFFECT_WARNING_THRESHOLD,
  USE_STATE_THRESHOLDS,
} from '../config/complexity-config.mjs';

// C01: 文件行数超限
const C01 = {
  code: 'C01',
  name: '文件行数超限',
  category: 'complexity',
  severity: 'warning',
  description: '组件文件行数过多表明职责过重，建议拆分',
  check(file, reporter) {
    const lineCount = file.lines.length;
    if (lineCount > FILE_LINE_THRESHOLDS.error) {
      reporter.add({
        file: file.relativePath,
        line: 1,
        col: 0,
        rule: 'C01',
        severity: 'error',
        message: `文件行数 ${lineCount} 行，超过 ${FILE_LINE_THRESHOLDS.error} 行阈值（建议拆分）`,
      });
    } else if (lineCount > FILE_LINE_THRESHOLDS.warning) {
      reporter.add({
        file: file.relativePath,
        line: 1,
        col: 0,
        rule: 'C01',
        severity: 'warning',
        message: `文件行数 ${lineCount} 行，超过 ${FILE_LINE_THRESHOLDS.warning} 行阈值`,
      });
    }
  },
};

// C02: useState 数量过多
const C02 = {
  code: 'C02',
  name: 'useState 过多',
  category: 'complexity',
  severity: 'warning',
  description: '单组件 useState 过多表明状态管理过于分散，建议提取自定义 Hook 或使用 useReducer',
  check(file, reporter) {
    const matches = file.content.match(/useState\(/g);
    const count = matches ? matches.length : 0;
    if (count > USE_STATE_THRESHOLDS.error) {
      reporter.add({
        file: file.relativePath,
        line: 1,
        col: 0,
        rule: 'C02',
        severity: 'error',
        message: `useState 数量 ${count} 个，超过 ${USE_STATE_THRESHOLDS.error} 个阈值（建议提取 Hook 或使用 useReducer）`,
      });
    } else if (count > USE_STATE_THRESHOLDS.warning) {
      reporter.add({
        file: file.relativePath,
        line: 1,
        col: 0,
        rule: 'C02',
        severity: 'warning',
        message: `useState 数量 ${count} 个，超过 ${USE_STATE_THRESHOLDS.warning} 个阈值`,
      });
    }
  },
};

// C03: useEffect 数量过多
const C03 = {
  code: 'C03',
  name: 'useEffect 过多',
  category: 'complexity',
  severity: 'warning',
  description: '过多副作用使组件行为难以追踪和调试',
  check(file, reporter) {
    const matches = file.content.match(/useEffect\(/g);
    const count = matches ? matches.length : 0;
    if (count > USE_EFFECT_WARNING_THRESHOLD) {
      reporter.add({
        file: file.relativePath,
        line: 1,
        col: 0,
        rule: 'C03',
        severity: 'warning',
        message: `useEffect 数量 ${count} 个，超过 ${USE_EFFECT_WARNING_THRESHOLD} 个阈值`,
      });
    }
  },
};

// C04: 综合复杂度评分
const C04 = {
  code: 'C04',
  name: '综合复杂度',
  category: 'complexity',
  severity: 'warning',
  description: '加权复杂度评分 = 行数*0.5 + useState*10 + useEffect*15 + handler*8 + import*2',
  check(file, reporter) {
    const content = file.content;
    const lineCount = file.lines.length;
    const useStateCount = (content.match(/useState\(/g) || []).length;
    const useEffectCount = (content.match(/useEffect\(/g) || []).length;
    const handlerCount = (content.match(/const handle\w+|function handle\w+/g) || []).length;
    const importCount = (content.match(/^import /gm) || []).length;

    const score = Math.round(
      lineCount * COMPLEXITY_SCORE_WEIGHTS.line +
      useStateCount * COMPLEXITY_SCORE_WEIGHTS.useState +
      useEffectCount * COMPLEXITY_SCORE_WEIGHTS.useEffect +
      handlerCount * COMPLEXITY_SCORE_WEIGHTS.handler +
      importCount * COMPLEXITY_SCORE_WEIGHTS.import
    );

    if (score > COMPLEXITY_SCORE_THRESHOLDS.error) {
      reporter.add({
        file: file.relativePath,
        line: 1,
        col: 0,
        rule: 'C04',
        severity: 'error',
        message: `综合复杂度评分 ${score}（阈值 ${COMPLEXITY_SCORE_THRESHOLDS.error}）-- 行:${lineCount} state:${useStateCount} effect:${useEffectCount} handler:${handlerCount} import:${importCount}`,
      });
    } else if (score > COMPLEXITY_SCORE_THRESHOLDS.warning) {
      reporter.add({
        file: file.relativePath,
        line: 1,
        col: 0,
        rule: 'C04',
        severity: 'warning',
        message: `综合复杂度评分 ${score}（阈值 ${COMPLEXITY_SCORE_THRESHOLDS.warning}）-- 行:${lineCount} state:${useStateCount} effect:${useEffectCount} handler:${handlerCount} import:${importCount}`,
      });
    }
  },
};

export default [C01, C02, C03, C04];
