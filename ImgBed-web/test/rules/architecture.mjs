/**
 * A 类规则: Architecture — 架构规范检查
 * A01-A04
 */
import path from 'node:path';
import { matchAllWithLines } from '../lib/assert.mjs';
import { API_IMPORT_WHITELIST, isWhitelistedByFileName } from '../config/api-config.mjs';
import { HOOK_DIR_MARKERS } from '../config/style-config.mjs';

// A01: API 调用规范（导入级）
const A01 = {
  code: 'A01',
  name: 'API 调用规范',
  category: 'architecture',
  severity: 'warning',
  description: '非 api.js 文件不应直接导入 api 实例，应通过 XxxDocs 封装对象',
  check(file, reporter) {
    if (isWhitelistedByFileName(file, API_IMPORT_WHITELIST)) return;

    // 检测 import api from 或 import { api } / import { api, ... }
    // 也检测 import api, { ... } from
    const patterns = [
      /^import\s+api\s+from\s/m,
      /^import\s+api\s*,\s*\{/m,
      /^import\s+\{[^}]*\bapi\b/m,
    ];

    for (const pattern of patterns) {
      const hits = matchAllWithLines(file.content, pattern);
      for (const hit of hits) {
        reporter.add({
          file: file.relativePath,
          line: hit.line,
          col: hit.col,
          rule: 'A01',
          severity: 'warning',
          message: '直接导入 api 实例 -- 应通过 XxxDocs 封装对象调用 API',
        });
      }
    }
  },
};

// A02: 循环依赖检测（DFS）
const A02 = {
  code: 'A02',
  name: '循环依赖',
  category: 'architecture',
  severity: 'error',
  description: '模块间循环 import 会导致运行时变量为 undefined',
  // 此规则需要全局视角，在 check 中标记依赖，在 checkAll 中检测环路
  _graph: null,

  check(file, reporter) {
    // 单文件阶段：仅收集依赖，不报告
    // 实际检测在 checkAll 中完成
  },

  /**
   * 全局检测方法 — 由 run.mjs 在所有文件扫描后调用
   */
  checkAll(files, reporter) {
    // 构建依赖图
    const graph = new Map();
    const fileMap = new Map();

    for (const file of files) {
      fileMap.set(file.relativePath, file);
      const deps = [];
      const importPattern = /import\s+.*\s+from\s+['"](\.[^'"]+)['"]/g;
      let m;
      while ((m = importPattern.exec(file.content)) !== null) {
        const importPath = m[1];
        // 解析相对路径
        const fileDir = path.dirname(file.relativePath);
        let resolved = path.posix.normalize(path.posix.join(fileDir, importPath));
        // 尝试补全扩展名
        const candidates = [
          resolved,
          resolved + '.js',
          resolved + '.jsx',
          resolved + '/index.js',
          resolved + '/index.jsx',
        ];
        for (const candidate of candidates) {
          if (fileMap.has(candidate) || files.some(f => f.relativePath === candidate)) {
            resolved = candidate;
            break;
          }
        }
        deps.push(resolved);
      }
      graph.set(file.relativePath, deps);
    }

    // DFS 检测环路
    const WHITE = 0, GRAY = 1, BLACK = 2;
    const color = new Map();
    const parent = new Map();
    const cycles = [];

    for (const node of graph.keys()) {
      color.set(node, WHITE);
    }

    function dfs(u) {
      color.set(u, GRAY);
      const deps = graph.get(u) || [];
      for (const v of deps) {
        if (!graph.has(v)) continue; // 外部依赖
        if (color.get(v) === GRAY) {
          // 发现环路
          const cycle = [v, u];
          let cur = u;
          while (parent.has(cur) && parent.get(cur) !== v) {
            cur = parent.get(cur);
            cycle.push(cur);
          }
          cycles.push(cycle);
        } else if (color.get(v) === WHITE) {
          parent.set(v, u);
          dfs(v);
        }
      }
      color.set(u, BLACK);
    }

    for (const node of graph.keys()) {
      if (color.get(node) === WHITE) {
        dfs(node);
      }
    }

    // 报告环路
    const reported = new Set();
    for (const cycle of cycles) {
      const key = [...cycle].sort().join(' -> ');
      if (reported.has(key)) continue;
      reported.add(key);
      for (const file of cycle) {
        if (graph.has(file)) {
          reporter.add({
            file,
            line: 1,
            col: 0,
            rule: 'A02',
            severity: 'error',
            message: `循环依赖: ${cycle.join(' -> ')}`,
          });
        }
      }
    }
  },
};

// A03: 组件目录归属检查
const A03 = {
  code: 'A03',
  name: '组件目录归属',
  category: 'architecture',
  severity: 'info',
  description: '检查文件内容特征与所在目录是否匹配',
  check(file, reporter) {
    // hooks/ 下的文件应导出以 use 开头的函数
    if (HOOK_DIR_MARKERS.some(marker => file.relativePath.includes(marker))) {
      const hasHookExport = /export\s+(?:default\s+)?function\s+use[A-Z]/.test(file.content);
      const hasHookConst = /export\s+(?:default\s+)?(?:const\s+)?use[A-Z]/.test(file.content);
      if (!hasHookExport && !hasHookConst) {
        reporter.add({
          file: file.relativePath,
          line: 1,
          col: 0,
          rule: 'A03',
          severity: 'info',
          message: 'hooks/ 目录下的文件应导出以 use 开头的 Hook 函数',
        });
      }
    }

    // components/ 下的 .jsx 文件含直接 API 调用（非 hook 转发）是可疑的
    if (file.relativePath.includes('components/') && file.filePath.endsWith('.jsx')) {
      // 检查是否直接在组件内调用 fetch/axios/api
      const hasDirectFetch = /\bawait\s+(?:fetch|axios|api)\b/.test(file.content);
      const hasApiImport = /import\s+.*(?:Docs|api)\s+from/.test(file.content);
      if (hasDirectFetch && hasApiImport) {
        // 组件直接发起 API 调用是合理的（如 Dialog 自管理状态）
        // 仅在没有任何 hook 抽象时提示
        const hasCustomHook = /use[A-Z]\w+\(/.test(file.content);
        if (!hasCustomHook && file.lines.length > 150) {
          reporter.add({
            file: file.relativePath,
            line: 1,
            col: 0,
            rule: 'A03',
            severity: 'info',
            message: '大型组件直接发起 API 调用 -- 建议提取为自定义 Hook',
          });
        }
      }
    }
  },
};

// A04: 组件中硬编码颜色值
const A04 = {
  code: 'A04',
  name: '硬编码颜色值',
  category: 'architecture',
  severity: 'info',
  description: '组件中不应硬编码 #hex 颜色值，应通过 theme.palette 引用以保持主题一致性',
  check(file, reporter) {
    if (!file.filePath.endsWith('.jsx')) return;

    // 白名单：主题定义文件中的颜色值是合理的
    if (file.relativePath.endsWith('main.jsx')) return;

    // 仅匹配 #hex 颜色值（6/8位，排除 3 位简写以降低误报）
    // rgba() 在 overlay/backdrop 中是合理用法，不报告
    const hexPattern = /#[0-9a-fA-F]{6,8}\b/g;

    const hits = matchAllWithLines(file.content, hexPattern);

    // 过滤掉注释行中的颜色值
    for (const hit of hits) {
      const line = file.lines[hit.line - 1] || '';
      if (/^\s*(\/\/|\/\*|\*)/.test(line)) continue;
      reporter.add({
        file: file.relativePath,
        line: hit.line,
        col: hit.col,
        rule: 'A04',
        severity: 'info',
        message: `硬编码颜色值 "${hit.match}" -- 建议通过 theme.palette 引用`,
      });
    }
  },
};

export default [A01, A02, A03, A04];
