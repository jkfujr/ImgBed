/**
 * B 类规则: Bug — 潜在缺陷检测
 * B01-B09
 */
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const testPlatformRoot = path.resolve(__dirname, '..', '..');

const { matchAllWithLines } = await import(pathToFileURL(path.join(testPlatformRoot, 'shared', 'lib', 'assert.mjs')).href);
const { API_CALL_WHITELIST, isWhitelistedByFileName } = await import('../config/api-config.mjs');

// B01: 冗余 localStorage 操作（与 useUserPreference 双写）
const B01 = {
  code: 'B01',
  name: '冗余 localStorage 操作',
  category: 'bug',
  severity: 'warning',
  description: '当状态已通过 useUserPreference 管理时，不应手动调用 localStorage.setItem',
  check(file, reporter) {
    // 提取 useUserPreference 的 key
    const prefPattern = /useUserPreference\(\s*['"]([\w]+)['"]/g;
    const keys = [];
    let m;
    while ((m = prefPattern.exec(file.content)) !== null) {
      keys.push(m[1]);
    }
    if (keys.length === 0) return;

    // 检查同文件中是否有 localStorage.setItem 使用相同 key
    for (const key of keys) {
      const lsPattern = new RegExp(`localStorage\\.setItem\\(\\s*['"]${key}['"]`, 'g');
      const hits = matchAllWithLines(file.content, lsPattern);
      for (const hit of hits) {
        reporter.add({
          file: file.relativePath,
          line: hit.line,
          col: hit.col,
          rule: 'B01',
          severity: 'warning',
          message: `冗余的 localStorage.setItem('${key}') -- useUserPreference 已自动持久化`,
        });
      }
    }
  },
};

// B02: 使用 index 作为列表 key
const B02 = {
  code: 'B02',
  name: 'index 作为列表 key',
  category: 'bug',
  severity: 'warning',
  description: 'key={index/idx/i} 在列表项可增删重排时会导致渲染异常',
  check(file, reporter) {
    if (!file.filePath.endsWith('.jsx')) return;
    const pattern = /key=\{(index|idx|i)\}/g;
    const hits = matchAllWithLines(file.content, pattern);
    for (const hit of hits) {
      reporter.add({
        file: file.relativePath,
        line: hit.line,
        col: hit.col,
        rule: 'B02',
        severity: 'warning',
        message: `使用 key={${hit.match.slice(5, -1)}} 作为列表键，可能导致渲染异常`,
      });
    }
  },
};

// B03: 裸 api 实例调用（绕过 Docs 封装）
const B03 = {
  code: 'B03',
  name: '裸 api 调用',
  category: 'bug',
  severity: 'warning',
  description: '非 api.js 文件不应直接使用 api.get/post/put/delete，应通过 XxxDocs 封装对象',
  check(file, reporter) {
    if (isWhitelistedByFileName(file, API_CALL_WHITELIST)) return;
    const pattern = /\bapi\.(get|post|put|delete)\s*\(/g;
    const hits = matchAllWithLines(file.content, pattern);
    for (const hit of hits) {
      reporter.add({
        file: file.relativePath,
        line: hit.line,
        col: hit.col,
        rule: 'B03',
        severity: 'warning',
        message: `直接使用 ${hit.match.slice(0, -1)} -- 应通过 XxxDocs 封装对象调用`,
      });
    }
  },
};

// B04: Promise .then() 无 .catch()
const B04 = {
  code: 'B04',
  name: 'Promise 未捕获',
  category: 'bug',
  severity: 'info',
  description: '裸 .then() 链缺少 .catch()，可能产生 unhandled rejection',
  check(file, reporter) {
    // 逐行检测含 .then( 但同行/前后无 .catch( 的语句
    for (let i = 0; i < file.lines.length; i++) {
      const line = file.lines[i];
      if (/\.then\s*\(/.test(line) && !/\.catch\s*\(/.test(line)) {
        // 排除 Promise.resolve().then() — 永远不会 reject
        if (/Promise\.resolve\s*\(\s*\)\s*\.then/.test(line)) continue;
        // 检查下一行是否有 .catch
        const nextLine = file.lines[i + 1] || '';
        if (!/\.catch\s*\(/.test(nextLine)) {
          // 检查是否在 try 块内（简易启发式：向上查找 try）
          let inTry = false;
          for (let j = i - 1; j >= Math.max(0, i - 10); j--) {
            if (/\btry\s*\{/.test(file.lines[j])) { inTry = true; break; }
            if (/\bcatch\s*[\({]/.test(file.lines[j])) break;
          }
          if (!inTry) {
            reporter.add({
              file: file.relativePath,
              line: i + 1,
              col: 1,
              rule: 'B04',
              severity: 'info',
              message: '.then() 链缺少 .catch()，可能产生未捕获的 Promise rejection',
            });
          }
        }
      }
    }
  },
};

// B05: useEffect 含事件监听但缺清理函数
const B05 = {
  code: 'B05',
  name: 'useEffect 缺清理',
  category: 'bug',
  severity: 'info',
  description: '含 addEventListener/setInterval/setTimeout 的 useEffect 应返回清理函数',
  check(file, reporter) {
    // 启发式：检测 useEffect 块中含副作用 API 但无 return 清理
    const effectStarts = matchAllWithLines(file.content, /useEffect\s*\(\s*(?:\(\)\s*=>|function)\s*\{/g);
    for (const start of effectStarts) {
      // 从 useEffect 开始行向下查找 40 行范围
      const endLine = Math.min(start.line + 40, file.lines.length);
      let hasListener = false;
      let hasCleanup = false;
      for (let i = start.line - 1; i < endLine; i++) {
        const line = file.lines[i];
        if (/addEventListener|setInterval\(|setTimeout\(/.test(line)) hasListener = true;
        if (/return\s*(?:\(\)\s*=>|function)/.test(line)) hasCleanup = true;
      }
      if (hasListener && !hasCleanup) {
        reporter.add({
          file: file.relativePath,
          line: start.line,
          col: start.col,
          rule: 'B05',
          severity: 'info',
          message: 'useEffect 含事件监听/定时器但未检测到清理函数（return () => ...）',
        });
      }
    }
  },
};

// B06: 直接修改 state 引用
const B06 = {
  code: 'B06',
  name: '直接修改 state',
  category: 'bug',
  severity: 'error',
  description: '不应直接修改 React state 引用类型（push/splice/pop 等），违反不可变更新原则',
  check(file, reporter) {
    // 提取所有 useState 的变量名
    const statePattern = /const\s+\[(\w+),\s*set\w+\]\s*=\s*useState/g;
    const stateVars = [];
    let m;
    while ((m = statePattern.exec(file.content)) !== null) {
      stateVars.push(m[1]);
    }
    if (stateVars.length === 0) return;

    const mutators = ['push', 'splice', 'pop', 'shift', 'unshift', 'sort', 'reverse', 'fill'];
    for (const varName of stateVars) {
      for (const mut of mutators) {
        const pattern = new RegExp(`\\b${varName}\\.${mut}\\s*\\(`, 'g');
        const hits = matchAllWithLines(file.content, pattern);
        for (const hit of hits) {
          reporter.add({
            file: file.relativePath,
            line: hit.line,
            col: hit.col,
            rule: 'B06',
            severity: 'error',
            message: `直接修改 state 变量 ${varName}.${mut}() -- 应使用 setter + 新数组/对象`,
          });
        }
      }
    }
  },
};

// B07: 重复导入同一模块
const B07 = {
  code: 'B07',
  name: '重复导入',
  category: 'bug',
  severity: 'warning',
  description: '同一模块被多次 import，应合并为单条导入语句',
  fixable: true,
  check(file, reporter) {
    // 提取所有 import ... from 'xxx' 的模块路径
    const importPattern = /^import\s+.*\s+from\s+['"]([^'"]+)['"]/gm;
    const moduleMap = new Map(); // module -> [行号]
    let m;
    while ((m = importPattern.exec(file.content)) !== null) {
      const modulePath = m[1];
      const line = file.content.slice(0, m.index).split('\n').length;
      if (!moduleMap.has(modulePath)) {
        moduleMap.set(modulePath, []);
      }
      moduleMap.get(modulePath).push(line);
    }

    for (const [mod, lines] of moduleMap) {
      if (lines.length > 1) {
        reporter.add({
          file: file.relativePath,
          line: lines[1], // 第二次导入的位置
          col: 1,
          rule: 'B07',
          severity: 'warning',
          message: `模块 "${mod}" 被导入了 ${lines.length} 次（行 ${lines.join(', ')}），应合并`,
        });
      }
    }
  },
  fix(file) {
    const importPattern = /^import\s+.*\s+from\s+['"]([^'"]+)['"]/gm;
    const moduleMap = new Map(); // module -> [{ line, text, namedImports[], defaultImport }]
    let m;
    while ((m = importPattern.exec(file.content)) !== null) {
      const modulePath = m[1];
      const lineIdx = file.content.slice(0, m.index).split('\n').length - 1;
      const lineText = file.lines[lineIdx];

      // 解析导入标识符
      const namedMatch = lineText.match(/\{([^}]+)\}/);
      const namedImports = namedMatch
        ? namedMatch[1].split(',').map(s => s.trim()).filter(Boolean)
        : [];
      const defaultMatch = lineText.match(/^import\s+(\w+)[\s,]/);
      const defaultImport = defaultMatch && defaultMatch[1] !== 'type' ? defaultMatch[1] : null;

      if (!moduleMap.has(modulePath)) {
        moduleMap.set(modulePath, []);
      }
      moduleMap.get(modulePath).push({
        lineIdx,
        text: lineText,
        namedImports,
        defaultImport,
      });
    }

    // 只处理重复导入的模块
    const duplicates = [...moduleMap.entries()].filter(([, entries]) => entries.length > 1);
    if (duplicates.length === 0) return null;

    const lines = [...file.lines];
    const changes = [];
    const linesToRemove = new Set();

    for (const [mod, entries] of duplicates) {
      // 合并所有命名导入
      const allNamed = new Set();
      let defaultImport = null;
      const quoteChar = entries[0].text.includes("'") ? "'" : '"';

      for (const entry of entries) {
        for (const name of entry.namedImports) allNamed.add(name);
        if (entry.defaultImport) defaultImport = entry.defaultImport;
      }

      // 构建合并后的导入语句
      const namedPart = allNamed.size > 0 ? `{ ${[...allNamed].join(', ')} }` : '';
      const parts = [defaultImport, namedPart].filter(Boolean).join(', ');
      const merged = `import ${parts} from ${quoteChar}${mod}${quoteChar};`;

      // 替换第一条，删除其余
      lines[entries[0].lineIdx] = merged;
      for (let i = 1; i < entries.length; i++) {
        linesToRemove.add(entries[i].lineIdx);
      }

      const lineNums = entries.map(e => e.lineIdx + 1).join(', ');
      changes.push({
        line: entries[0].lineIdx + 1,
        description: `合并 ${entries.length} 条重复导入 "${mod}"（原行 ${lineNums}）`,
      });
    }

    // 删除多余行（从后向前避免索引偏移）
    const sortedRemove = [...linesToRemove].sort((a, b) => b - a);
    for (const idx of sortedRemove) {
      lines.splice(idx, 1);
    }

    return { content: lines.join('\n'), changes };
  },
};

// B08: .map() 回调中引用未声明的循环变量
const B08 = {
  code: 'B08',
  name: 'map 回调变量泄漏',
  category: 'bug',
  severity: 'error',
  description: '.map() 回调使用了 index 但未在参数中声明，导致引用外部或 undefined 变量',
  check(file, reporter) {
    if (!file.filePath.endsWith('.jsx')) return;

    // 查找 .map((item) => 模式（仅一个参数，无 index）
    // 然后检查回调体内是否使用了 index
    const mapPattern = /\.map\(\s*\((\w+)\)\s*=>/g;
    let m;
    while ((m = mapPattern.exec(file.content)) !== null) {
      const mapStart = m.index + m[0].length;
      // 提取后续的回调体（简易：取到对应的闭括号）
      let depth = 0;
      let bodyEnd = -1;
      for (let i = mapStart; i < file.content.length; i++) {
        if (file.content[i] === '(' || file.content[i] === '{') depth++;
        if (file.content[i] === ')' || file.content[i] === '}') {
          depth--;
          if (depth < 0) { bodyEnd = i; break; }
        }
      }
      if (bodyEnd === -1) continue;

      const body = file.content.slice(mapStart, bodyEnd);
      // 检查 body 中是否使用了 index 变量（非字符串内）
      if (/\bindex\b/.test(body)) {
        const line = file.content.slice(0, m.index).split('\n').length;
        reporter.add({
          file: file.relativePath,
          line,
          col: 1,
          rule: 'B08',
          severity: 'error',
          message: `.map() 回调参数未声明 index，但回调体内引用了 index 变量`,
        });
      }
    }
  },
};

// B09: .length && <JSX> 可能渲染数字 0
const B09 = {
  code: 'B09',
  name: '条件渲染泄漏 0',
  category: 'bug',
  severity: 'warning',
  description: '{arr.length && <Comp />} 当数组为空时会渲染数字 0，应使用 arr.length > 0',
  fixable: true,
  check(file, reporter) {
    if (!file.filePath.endsWith('.jsx')) return;

    // 匹配 {xxx.length && 但排除 xxx.length > 0 &&
    const pattern = /\{(\w+(?:\.\w+)*)\.length\s*&&/g;
    const hits = matchAllWithLines(file.content, pattern);
    for (const hit of hits) {
      reporter.add({
        file: file.relativePath,
        line: hit.line,
        col: hit.col,
        rule: 'B09',
        severity: 'warning',
        message: `{${hit.match.slice(1, -2).trim()}} 当数组为空时会渲染数字 0，应使用 .length > 0 &&`,
      });
    }
  },
  fix(file) {
    if (!file.filePath.endsWith('.jsx')) return null;

    const pattern = /\{(\w+(?:\.\w+)*)\.length\s*&&/g;
    let content = file.content;
    const changes = [];
    let m;

    // 收集所有匹配（从后向前替换避免索引偏移）
    const matches = [];
    while ((m = pattern.exec(content)) !== null) {
      matches.push({ index: m.index, match: m[0], expr: m[1] });
    }

    if (matches.length === 0) return null;

    // 从后向前替换
    for (let i = matches.length - 1; i >= 0; i--) {
      const hit = matches[i];
      const before = content.slice(0, hit.index);
      const after = content.slice(hit.index + hit.match.length);
      content = before + `{${hit.expr}.length > 0 &&` + after;

      const line = before.split('\n').length;
      changes.push({
        line,
        description: `替换 {${hit.expr}.length && → {${hit.expr}.length > 0 &&`,
      });
    }

    return { content, changes };
  },
};

export default [B01, B02, B03, B04, B05, B06, B07, B08, B09];
