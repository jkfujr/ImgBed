/**
 * U 类规则: Unused — 未使用/冗余代码检测
 * U01-U02
 */
import { matchAllWithLines } from '../lib/assert.mjs';
import {
  ALLOW_CONSOLE_INFO_METHODS,
  DEBUG_CONSOLE_METHODS,
  UNUSED_IMPORT_IGNORE_DEFAULTS,
} from '../config/unused-config.mjs';

// U01: 可能未使用的导入
const U01 = {
  code: 'U01',
  name: '未使用的导入',
  category: 'unused',
  severity: 'warning',
  description: '导入了标识符但在文件后续代码中未引用（补充 ESLint 对大写变量的盲区）',
  fixable: true,
  check(file, reporter) {
    // 解析命名导入 import { A, B, C } from '...'
    const importPattern = /^import\s+\{([^}]+)\}\s+from\s+/gm;
    let m;
    while ((m = importPattern.exec(file.content)) !== null) {
      const importLine = m[0];
      const identifiers = m[1]
        .split(',')
        .map(s => s.trim().split(/\s+as\s+/).pop().trim())
        .filter(Boolean);

      // 获取 import 行之后的内容
      const importLineEnd = file.content.indexOf('\n', m.index);
      const restContent = file.content.slice(importLineEnd + 1);

      for (const id of identifiers) {
        // 检查整个文件中（排除所有 import 行）是否使用了该标识符
        const usePattern = new RegExp(`\\b${escapeRegExp(id)}\\b`);
        const nonImportContent = file.content.replace(/^import\s+.*$/gm, '');
        if (!usePattern.test(nonImportContent)) {
          const hits = matchAllWithLines(file.content, new RegExp(`\\b${escapeRegExp(id)}\\b`));
          const line = hits.length > 0 ? hits[0].line : 1;
          reporter.add({
            file: file.relativePath,
            line,
            col: 1,
            rule: 'U01',
            severity: 'warning',
            message: `导入的 "${id}" 在文件中未被使用`,
          });
        }
      }
    }

    // 解析默认导入 import SomeName from '...'（排除 import React）
    const defaultImportPattern = /^import\s+([A-Z]\w+)\s+from\s+/gm;
    while ((m = defaultImportPattern.exec(file.content)) !== null) {
      const id = m[1];
      if (UNUSED_IMPORT_IGNORE_DEFAULTS.includes(id)) continue; // S02 规则单独处理

      const importLineEnd = file.content.indexOf('\n', m.index);
      const restContent = file.content.slice(importLineEnd + 1);

      const usePattern = new RegExp(`\\b${escapeRegExp(id)}\\b`);
      const nonImportContent = file.content.replace(/^import\s+.*$/gm, '');
      if (!usePattern.test(nonImportContent)) {
        const hits = matchAllWithLines(file.content, new RegExp(`import\\s+${escapeRegExp(id)}\\s+from`));
        const line = hits.length > 0 ? hits[0].line : 1;
        reporter.add({
          file: file.relativePath,
          line,
          col: 1,
          rule: 'U01',
          severity: 'warning',
          message: `默认导入的 "${id}" 在文件中未被使用`,
        });
      }
    }
  },
  fix(file) {
    const lines = [...file.lines];
    const changes = [];
    const nonImportContent = file.content.replace(/^import\s+.*$/gm, '');
    const linesToRemove = new Set();

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      // 命名导入
      const namedMatch = line.match(/^import\s+\{([^}]+)\}\s+from\s+(['"][^'"]+['"])/);
      if (namedMatch) {
        const identifiers = namedMatch[1].split(',').map(s => s.trim()).filter(Boolean);
        const usedIds = identifiers.filter(idStr => {
          const id = idStr.split(/\s+as\s+/).pop().trim();
          return new RegExp(`\\b${escapeRegExp(id)}\\b`).test(nonImportContent);
        });

        if (usedIds.length === identifiers.length) continue; // 全部使用
        if (usedIds.length === 0) {
          // 全部未使用，删除整行
          linesToRemove.add(i);
          changes.push({
            line: i + 1,
            description: `移除未使用的导入行: ${identifiers.map(s => s.split(/\s+as\s+/).pop().trim()).join(', ')}`,
          });
        } else {
          // 部分未使用，移除未使用的标识符
          const removed = identifiers.filter(id => !usedIds.includes(id));
          lines[i] = `import { ${usedIds.join(', ')} } from ${namedMatch[2]};`;
          changes.push({
            line: i + 1,
            description: `移除未使用的标识符: ${removed.map(s => s.split(/\s+as\s+/).pop().trim()).join(', ')}`,
          });
        }
        continue;
      }

      // 默认导入
      const defaultMatch = line.match(/^import\s+([A-Z]\w+)\s+from\s+/);
      if (defaultMatch) {
        const id = defaultMatch[1];
        if (id === 'React') continue;
        if (!new RegExp(`\\b${escapeRegExp(id)}\\b`).test(nonImportContent)) {
          linesToRemove.add(i);
          changes.push({
            line: i + 1,
            description: `移除未使用的默认导入: ${id}`,
          });
        }
      }
    }

    if (changes.length === 0) return null;

    // 删除整行（从后向前）
    const sortedRemove = [...linesToRemove].sort((a, b) => b - a);
    for (const idx of sortedRemove) {
      lines.splice(idx, 1);
    }

    return { content: lines.join('\n'), changes };
  },
};

// U02: console 语句残留
const U02 = {
  code: 'U02',
  name: 'console 残留',
  category: 'unused',
  severity: 'warning',
  description: '生产代码中不应残留调试用 console 语句',
  fixable: true,
  check(file, reporter) {
    // console.log/debug/warn/info 为 warning
    const debugPattern = new RegExp(`console\\.(${DEBUG_CONSOLE_METHODS.join('|')})\\s*\\(`, 'g');
    const debugHits = matchAllWithLines(file.content, debugPattern);
    for (const hit of debugHits) {
      reporter.add({
        file: file.relativePath,
        line: hit.line,
        col: hit.col,
        rule: 'U02',
        severity: 'warning',
        message: `console.${hit.match.match(/console\.(\w+)/)[1]}() 调试语句残留`,
      });
    }

    // console.error 为 info（在 catch 中合理使用）
    const errorPattern = new RegExp(`console\\.(${ALLOW_CONSOLE_INFO_METHODS.join('|')})\\s*\\(`, 'g');
    const errorHits = matchAllWithLines(file.content, errorPattern);
    for (const hit of errorHits) {
      reporter.add({
        file: file.relativePath,
        line: hit.line,
        col: hit.col,
        rule: 'U02',
        severity: 'info',
        message: 'console.error() -- 生产环境建议使用日志服务替代',
      });
    }
  },
  fix(file) {
    // 仅修复 warning 级别的 console 调用（log/debug/warn/info），不动 console.error
    const lines = [...file.lines];
    const changes = [];
    const linesToRemove = new Set();

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      // 跳过注释行
      if (/^\s*(\/\/|\/\*|\*)/.test(line)) continue;

      // 匹配独占一行的 console.log/debug/warn/info 调用
      if (new RegExp(`^\\s*console\\.(?:${DEBUG_CONSOLE_METHODS.join('|')})\\s*\\(`).test(line)) {
        // 检查是否是完整语句（简单启发式：行末有 ; 或 ) ）
        const trimmed = line.trim();
        if (/;\s*$/.test(trimmed) || /\)\s*$/.test(trimmed)) {
          linesToRemove.add(i);
          const method = line.match(/console\.(\w+)/)[1];
          changes.push({
            line: i + 1,
            description: `移除 console.${method}() 调试语句`,
          });
        }
      }
    }

    if (changes.length === 0) return null;

    // 从后向前删除
    const sortedRemove = [...linesToRemove].sort((a, b) => b - a);
    for (const idx of sortedRemove) {
      lines.splice(idx, 1);
    }

    return { content: lines.join('\n'), changes };
  },
};

/** 转义正则特殊字符 */
function escapeRegExp(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export default [U01, U02];
