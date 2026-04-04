/**
 * S 类规则: Style — 代码风格一致性
 * S01-S08
 */
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const testPlatformRoot = path.resolve(__dirname, '..', '..');

const { matchAllWithLines } = await import(pathToFileURL(path.join(testPlatformRoot, 'shared', 'lib', 'assert.mjs')).href);
const {
  COMPONENT_DIR_MARKERS,
  COMPONENT_FILE_EXTENSIONS,
  HOOK_DIR_MARKERS,
  HOOK_EXPORT_PREFERENCE,
  HOOK_NAME_PREFIX,
  MAX_IMPORT_LENGTH,
  REACT_DEFAULT_IMPORT_NAME,
} = await import('../config/style-config.mjs');

// S01: hooks 导出方式不一致
const S01 = {
  code: 'S01',
  name: '导出方式不一致',
  category: 'style',
  severity: 'info',
  description: 'hooks 目录下的文件导出方式应统一（命名导出 vs 默认导出）',
  check(file, reporter) {
    if (!HOOK_DIR_MARKERS.some(marker => file.relativePath.includes(marker))) return;

    const hasDefaultExport = /^export default /m.test(file.content);
    const hasNamedExport = /^export (function|const) /m.test(file.content);
    const preferDefaultExport = HOOK_EXPORT_PREFERENCE === 'default';

    // 优先约定: hooks 应使用 export default function
    // 此处仅标记使用 default export 同时文件内也含 named export 的情况
    // 或者反之：标记与多数 hooks 不一致的导出方式
    if (preferDefaultExport && hasDefaultExport && !hasNamedExport) {
      // 使用 default export — 当前 useImageTransform 的方式
      // 暂不报告，因为 default export 也是合理选择
    } else if (hasNamedExport && hasDefaultExport) {
      reporter.add({
        file: file.relativePath,
        line: 1,
        col: 0,
        rule: 'S01',
        severity: 'info',
        message: 'Hook 文件同时存在命名导出和默认导出，建议统一',
      });
    }
  },
};

// S02: 冗余 React 默认导入
const S02 = {
  code: 'S02',
  name: '冗余 React 导入',
  category: 'style',
  severity: 'warning',
  description: 'React 19 + Vite 的新 JSX transform 不需要 import React 默认导入',
  fixable: true,
  check(file, reporter) {
    const reactImportPattern = new RegExp(`^import\\s+${REACT_DEFAULT_IMPORT_NAME}[\\s,]`, 'm');
    const importMatch = file.content.match(reactImportPattern);
    if (!importMatch) return;

    const reactMemberPattern = new RegExp(`${REACT_DEFAULT_IMPORT_NAME}\\.\\w+`);
    const contentWithoutImport = file.content.replace(/^import\s+.*$/gm, '');
    if (reactMemberPattern.test(contentWithoutImport)) return;

    // 找到 import React 所在行
    const hits = matchAllWithLines(file.content, reactImportPattern);
    if (hits.length > 0) {
      reporter.add({
        file: file.relativePath,
        line: hits[0].line,
        col: hits[0].col,
        rule: 'S02',
        severity: 'warning',
        message: '冗余的 React 默认导入 -- React 19 的 JSX transform 不需要显式导入 React',
      });
    }
  },
  fix(file) {
    const reactImportPattern = new RegExp(`^import\\s+${REACT_DEFAULT_IMPORT_NAME}[\\s,]`, 'm');
    const importMatch = file.content.match(reactImportPattern);
    if (!importMatch) return null;

    const reactMemberPattern = new RegExp(`${REACT_DEFAULT_IMPORT_NAME}\\.\\w+`);
    const contentWithoutImport = file.content.replace(/^import\s+.*$/gm, '');
    if (reactMemberPattern.test(contentWithoutImport)) return null;

    const lines = file.content.split('\n');
    const changes = [];
    const newLines = [];

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      // import React from 'react' — 直接删除整行
      if (/^import\s+React\s+from\s+['"]react['"]/.test(line)) {
        changes.push({ line: i + 1, description: `移除冗余 React 默认导入: ${line.trim()}` });
        continue;
      }
      // import React, { useState } from 'react' — 移除 React 默认导入部分
      if (/^import\s+React\s*,\s*\{/.test(line)) {
        const fixed = line.replace(/^import\s+React\s*,\s*/, 'import ');
        newLines.push(fixed);
        changes.push({ line: i + 1, description: `移除 React 默认导入部分: React,` });
        continue;
      }
      newLines.push(line);
    }

    if (changes.length === 0) return null;
    return { content: newLines.join('\n'), changes };
  },
};

// S03: 组件定义方式不一致
const S03 = {
  code: 'S03',
  name: '组件定义方式不一致',
  category: 'style',
  severity: 'info',
  description: '建议使用 export default function ComponentName 替代箭头函数 + 底部导出',
  check(file, reporter) {
    if (!COMPONENT_FILE_EXTENSIONS.some(ext => file.filePath.endsWith(ext))) return;

    // 检测底部 export default VariableName; 模式
    const bottomExport = /^export default [A-Z]\w+;$/m;
    if (bottomExport.test(file.content) && !/export default function/.test(file.content)) {
      const hits = matchAllWithLines(file.content, bottomExport);
      if (hits.length > 0) {
        reporter.add({
          file: file.relativePath,
          line: hits[0].line,
          col: hits[0].col,
          rule: 'S03',
          severity: 'info',
          message: '使用了箭头函数 + 底部 export default 模式，建议改为 export default function 声明式',
        });
      }
    }
  },
};

// S04: 文件命名规范
const S04 = {
  code: 'S04',
  name: '文件命名规范',
  category: 'style',
  severity: 'info',
  description: '组件文件应 PascalCase，hooks 应 use 前缀 camelCase',
  check(file, reporter) {
    const fileName = file.relativePath.split('/').pop();
    const nameWithoutExt = fileName.replace(/\.\w+$/, '');

    if (COMPONENT_DIR_MARKERS.some(marker => file.relativePath.includes(marker))) {
      // .jsx 文件应 PascalCase
      if (COMPONENT_FILE_EXTENSIONS.some(ext => file.filePath.endsWith(ext)) && !/^[A-Z]/.test(nameWithoutExt)) {
        reporter.add({
          file: file.relativePath,
          line: 1,
          col: 0,
          rule: 'S04',
          severity: 'info',
          message: `组件文件名 "${fileName}" 应使用 PascalCase`,
        });
      }
    }

    if (HOOK_DIR_MARKERS.some(marker => file.relativePath.includes(marker))) {
      const hookNamePattern = new RegExp(`^${HOOK_NAME_PREFIX}[A-Z]`);
      if (!hookNamePattern.test(nameWithoutExt)) {
        reporter.add({
          file: file.relativePath,
          line: 1,
          col: 0,
          rule: 'S04',
          severity: 'info',
          message: `Hook 文件名 "${fileName}" 应以 use 前缀 + PascalCase 命名`,
        });
      }
    }
  },
};

// S05: Hook 命名规范
const S05 = {
  code: 'S05',
  name: 'Hook 命名规范',
  category: 'style',
  severity: 'warning',
  description: '自定义 Hook 函数名必须以 use 开头',
  check(file, reporter) {
    if (!HOOK_DIR_MARKERS.some(marker => file.relativePath.includes(marker))) return;

    // 提取导出函数名
    const exportPattern = /export\s+(?:default\s+)?function\s+(\w+)/g;
    const hookNamePattern = new RegExp(`^${HOOK_NAME_PREFIX}[A-Z]`);
    let m;
    while ((m = exportPattern.exec(file.content)) !== null) {
      const funcName = m[1];
      if (!hookNamePattern.test(funcName)) {
        const hits = matchAllWithLines(file.content, new RegExp(`function\\s+${funcName}`));
        reporter.add({
          file: file.relativePath,
          line: hits[0]?.line || 1,
          col: hits[0]?.col || 0,
          rule: 'S05',
          severity: 'warning',
          message: `Hook 函数名 "${funcName}" 未以 use 开头，违反 React Hooks 约定`,
        });
      }
    }
  },
};

// S06: 空 catch 块
const S06 = {
  code: 'S06',
  name: '空 catch 块',
  category: 'style',
  severity: 'warning',
  description: '空 catch 块会吞没异常，应至少包含 console.error 或注释说明',
  fixable: true,
  check(file, reporter) {
    for (let i = 0; i < file.lines.length; i++) {
      const line = file.lines[i].trim();
      // 匹配 } catch { } 或 } catch (e) { } 在同一行或跨两行
      if (/catch\s*(?:\([^)]*\))?\s*\{\s*\}/.test(line)) {
        reporter.add({
          file: file.relativePath,
          line: i + 1,
          col: 1,
          rule: 'S06',
          severity: 'warning',
          message: '空 catch 块，可能吞没异常',
        });
      }
      // 跨行的空 catch: catch { 后下一行是 }
      if (/catch\s*(?:\([^)]*\))?\s*\{\s*$/.test(line)) {
        const nextLine = (file.lines[i + 1] || '').trim();
        if (nextLine === '}') {
          reporter.add({
            file: file.relativePath,
            line: i + 1,
            col: 1,
            rule: 'S06',
            severity: 'warning',
            message: '空 catch 块，可能吞没异常',
          });
        }
      }
    }
  },
  fix(file) {
    const lines = [...file.lines];
    const changes = [];

    for (let i = 0; i < lines.length; i++) {
      const trimmed = lines[i].trim();

      // 同行空 catch: catch (e) { }
      if (/catch\s*(?:\([^)]*\))?\s*\{\s*\}/.test(trimmed)) {
        lines[i] = lines[i].replace(/\{\s*\}/, '{ /* 忽略 */ }');
        changes.push({ line: i + 1, description: '在空 catch 块中添加 /* 忽略 */ 注释' });
        continue;
      }

      // 跨行空 catch
      if (/catch\s*(?:\([^)]*\))?\s*\{\s*$/.test(trimmed)) {
        const nextTrimmed = (lines[i + 1] || '').trim();
        if (nextTrimmed === '}') {
          // 在 catch { 和 } 之间插入注释
          const indent = lines[i + 1].match(/^(\s*)/)[1];
          lines[i + 1] = indent + '  /* 忽略 */\n' + lines[i + 1];
          changes.push({ line: i + 1, description: '在空 catch 块中添加 /* 忽略 */ 注释' });
        }
      }
    }

    if (changes.length === 0) return null;
    return { content: lines.join('\n'), changes };
  },
};

// S07: 嵌套三元表达式
const S07 = {
  code: 'S07',
  name: '嵌套三元表达式',
  category: 'style',
  severity: 'warning',
  description: '同一行内多层嵌套三元运算符会降低可读性，建议重构为条件语句或对象映射',
  check(file, reporter) {
    for (let i = 0; i < file.lines.length; i++) {
      const line = file.lines[i];
      // 排除注释行
      if (/^\s*(\/\/|\/\*|\*)/.test(line)) continue;

      // 移除字符串字面量内容，避免误匹配
      const cleaned = line.replace(/'[^']*'|"[^"]*"|`[^`]*`/g, '""');

      // 移除 ?? 空值合并运算符和 ?. 可选链
      const withoutNullish = cleaned.replace(/\?\?|\?\./g, '  ');

      // 统计剩余 ? 的数量（即真正的三元运算符）
      const ternaryMarks = withoutNullish.match(/\?/g);
      if (ternaryMarks && ternaryMarks.length >= 2) {
        reporter.add({
          file: file.relativePath,
          line: i + 1,
          col: 1,
          rule: 'S07',
          severity: 'warning',
          message: `同一行有 ${ternaryMarks.length} 层三元运算符嵌套，建议拆分为独立语句或对象映射`,
        });
      }
    }
  },
};

// S08: 超长导入行
const S08 = {
  code: 'S08',
  name: '超长导入行',
  category: 'style',
  severity: 'info',
  description: '导入语句超过 120 字符时建议换行，提升可读性',
  fixable: true,
  check(file, reporter) {
    for (let i = 0; i < file.lines.length; i++) {
      const line = file.lines[i];
      if (/^import\s+/.test(line) && line.length > MAX_IMPORT_LENGTH) {
        reporter.add({
          file: file.relativePath,
          line: i + 1,
          col: 121,
          rule: 'S08',
          severity: 'info',
          message: `导入语句长度 ${line.length} 字符，超过 120 字符阈值，建议拆分为多行`,
        });
      }
    }
  },
  fix(file) {
    const lines = [...file.lines];
    const changes = [];

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (!/^import\s+/.test(line) || line.length <= 120) continue;

      // 匹配 import { A, B, C } from 'xxx'
      const m = line.match(/^(import\s+)\{([^}]+)\}(\s+from\s+.+)$/);
      if (!m) continue;

      const prefix = m[1];
      const identifiers = m[2].split(',').map(s => s.trim()).filter(Boolean);
      const suffix = m[3];

      if (identifiers.length <= 1) continue;

      // 计算缩进
      const indent = line.match(/^(\s*)/)[1];
      const innerIndent = indent + '  ';

      const newImport = [
        `${prefix}{`,
        ...identifiers.map((id, idx) =>
          `${innerIndent}${id}${idx < identifiers.length - 1 ? ',' : ''}`
        ),
        `${indent}}${suffix}`,
      ].join('\n');

      lines[i] = newImport;
      changes.push({
        line: i + 1,
        description: `拆分超长导入（${line.length} 字符 → 多行）: ${identifiers.length} 个标识符`,
      });
    }

    if (changes.length === 0) return null;
    return { content: lines.join('\n'), changes };
  },
};

export default [S01, S02, S03, S04, S05, S06, S07, S08];
