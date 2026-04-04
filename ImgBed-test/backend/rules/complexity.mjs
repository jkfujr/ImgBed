/**
 * C 类规则: Complexity — 后端复杂度分析
 * C01-C03
 */

const FILE_TYPE_THRESHOLDS = {
  routeAggregator: { warning: 450, error: 700 },
  routeSingleHeavy: { warning: 300, error: 450 },
  managerService: { warning: 550, error: 850 },
  middleware: { warning: 180, error: 300 },
  default: { warning: 250, error: 500 },
};

const ROUTE_HANDLER_THRESHOLDS = {
  routeAggregator: { warning: 12, error: 18 },
};

const HEAVY_HANDLER_SCORE_THRESHOLDS = {
  warning: 20,
  error: 32,
};

const ROUTE_METHOD_PATTERN = /([A-Za-z_$][\w$]*)\.(get|post|put|delete|patch)\s*\(/g;

function findClosingParen(content, openIndex) {
  let depth = 0;
  let quote = null;
  let escaped = false;

  for (let i = openIndex; i < content.length; i++) {
    const char = content[i];

    if (quote) {
      if (escaped) {
        escaped = false;
        continue;
      }
      if (char === '\\') {
        escaped = true;
        continue;
      }
      if (char === quote) {
        quote = null;
      }
      continue;
    }

    if (char === '\'' || char === '"' || char === '`') {
      quote = char;
      continue;
    }

    if (char === '(') depth++;
    if (char === ')') {
      depth--;
      if (depth === 0) return i;
    }
  }

  return -1;
}

function splitTopLevelArgs(text) {
  const args = [];
  let current = '';
  let depthParen = 0;
  let depthBracket = 0;
  let depthBrace = 0;
  let quote = null;
  let escaped = false;

  for (const char of text) {
    current += char;

    if (quote) {
      if (escaped) {
        escaped = false;
        continue;
      }
      if (char === '\\') {
        escaped = true;
        continue;
      }
      if (char === quote) {
        quote = null;
      }
      continue;
    }

    if (char === '\'' || char === '"' || char === '`') {
      quote = char;
      continue;
    }

    if (char === '(') depthParen++;
    else if (char === ')') depthParen--;
    else if (char === '[') depthBracket++;
    else if (char === ']') depthBracket--;
    else if (char === '{') depthBrace++;
    else if (char === '}') depthBrace--;
    else if (char === ',' && depthParen === 0 && depthBracket === 0 && depthBrace === 0) {
      args.push(current.slice(0, -1).trim());
      current = '';
    }
  }

  if (current.trim()) {
    args.push(current.trim());
  }

  return args;
}

function getLineNumber(content, index) {
  return content.slice(0, index).split('\n').length;
}

function classifyFile(file) {
  const relativePath = file.relativePath;

  if (relativePath === 'src/routes/system.js' || relativePath === 'src/routes/files.js') {
    return 'routeAggregator';
  }
  if (relativePath === 'src/routes/upload.js') {
    return 'routeSingleHeavy';
  }
  if (relativePath === 'src/storage/manager.js') {
    return 'managerService';
  }
  if (relativePath.startsWith('src/middleware/')) {
    return 'middleware';
  }
  return 'default';
}

function getThresholds(file) {
  return FILE_TYPE_THRESHOLDS[classifyFile(file)] || FILE_TYPE_THRESHOLDS.default;
}

function getRouteDefinitions(file) {
  const routes = [];
  const content = file.content;

  for (const match of content.matchAll(ROUTE_METHOD_PATTERN)) {
    const openParenIndex = match.index + match[0].length - 1;
    const closeParenIndex = findClosingParen(content, openParenIndex);
    if (closeParenIndex === -1) continue;

    const argsText = content.slice(openParenIndex + 1, closeParenIndex);
    const args = splitTopLevelArgs(argsText);
    if (args.length < 2) continue;

    const pathArg = args[0].trim();
    const routePathMatch = pathArg.match(/^['"]([^'"]+)['"]$/);
    if (!routePathMatch) continue;

    const handlerArg = args[args.length - 1];
    routes.push({
      appName: match[1],
      method: match[2].toUpperCase(),
      path: routePathMatch[1],
      line: getLineNumber(content, match.index),
      handlerText: handlerArg,
    });
  }

  return routes;
}

function measureHandlerComplexity(handlerText) {
  const branchCount = (handlerText.match(/\bif\s*\(|\belse\s+if\s*\(|\bswitch\s*\(/g) || []).length;
  const loopCount = (handlerText.match(/\bfor\s*\(|\bfor\s+await\s*\(|\bwhile\s*\(/g) || []).length;
  const tryCatchCount = (handlerText.match(/\btry\s*\{|\bcatch\s*\(/g) || []).length;
  const awaitCount = (handlerText.match(/\bawait\b/g) || []).length;
  const returnCount = (handlerText.match(/\breturn\b/g) || []).length;
  const lineCount = handlerText.split('\n').length;

  let maxDepth = 0;
  let currentDepth = 0;
  let quote = null;
  let escaped = false;

  for (const char of handlerText) {
    if (quote) {
      if (escaped) {
        escaped = false;
        continue;
      }
      if (char === '\\') {
        escaped = true;
        continue;
      }
      if (char === quote) {
        quote = null;
      }
      continue;
    }

    if (char === '\'' || char === '"' || char === '`') {
      quote = char;
      continue;
    }

    if (char === '{') {
      currentDepth++;
      maxDepth = Math.max(maxDepth, currentDepth);
    } else if (char === '}') {
      currentDepth = Math.max(0, currentDepth - 1);
    }
  }

  const score = branchCount * 2 + loopCount * 3 + tryCatchCount * 2 + awaitCount + Math.max(0, maxDepth - 2) * 3 + Math.max(0, lineCount - 80) / 10 + Math.max(0, returnCount - 3);

  return {
    branchCount,
    loopCount,
    tryCatchCount,
    awaitCount,
    returnCount,
    lineCount,
    maxDepth,
    score,
  };
}

const C01 = {
  code: 'C01',
  name: '后端文件行数超限',
  category: 'complexity',
  severity: 'warning',
  description: '后端文件应按类型控制体量，过长时应考虑按职责拆分',
  check(file, reporter) {
    const thresholds = getThresholds(file);
    const lineCount = file.lines.length;
    if (lineCount > thresholds.error) {
      reporter.add({
        file: file.relativePath,
        line: 1,
        col: 0,
        rule: 'C01',
        severity: 'error',
        message: `文件行数 ${lineCount} 行，超过 ${thresholds.error} 行阈值`,
      });
      return;
    }

    if (lineCount > thresholds.warning) {
      reporter.add({
        file: file.relativePath,
        line: 1,
        col: 0,
        rule: 'C01',
        severity: 'warning',
        message: `文件行数 ${lineCount} 行，超过 ${thresholds.warning} 行阈值`,
      });
    }
  },
};

const C02 = {
  code: 'C02',
  name: '聚合路由处理器过多',
  category: 'complexity',
  severity: 'warning',
  description: '系统或文件聚合路由挂载过多处理器时应考虑按领域拆分',
  check(file, reporter) {
    if (classifyFile(file) !== 'routeAggregator') return;

    const routeHandlerCount = (file.content.match(/\.(get|post|put|delete|patch)\s*\(/g) || []).length;
    const thresholds = ROUTE_HANDLER_THRESHOLDS.routeAggregator;

    if (routeHandlerCount > thresholds.error) {
      reporter.add({
        file: file.relativePath,
        line: 1,
        col: 0,
        rule: 'C02',
        severity: 'error',
        message: `聚合路由处理器数量 ${routeHandlerCount} 个，超过 ${thresholds.error} 个阈值`,
      });
      return;
    }

    if (routeHandlerCount > thresholds.warning) {
      reporter.add({
        file: file.relativePath,
        line: 1,
        col: 0,
        rule: 'C02',
        severity: 'warning',
        message: `聚合路由处理器数量 ${routeHandlerCount} 个，超过 ${thresholds.warning} 个阈值`,
      });
    }
  },
};

const C03 = {
  code: 'C03',
  name: '单个路由处理器流程过深',
  category: 'complexity',
  severity: 'warning',
  description: '单个路由处理器若包含过多分支、循环、await 与嵌套，应考虑拆出辅助函数',
  check(file, reporter) {
    if (!file.relativePath.startsWith('src/routes/')) return;

    const routes = getRouteDefinitions(file);
    for (const route of routes) {
      const metrics = measureHandlerComplexity(route.handlerText);
      if (metrics.score > HEAVY_HANDLER_SCORE_THRESHOLDS.error) {
        reporter.add({
          file: file.relativePath,
          line: route.line,
          col: 1,
          rule: 'C03',
          severity: 'error',
          message: `路由 ${route.method} ${route.path} 流程复杂度过高（评分 ${metrics.score.toFixed(1)}，await ${metrics.awaitCount}，最大嵌套 ${metrics.maxDepth}）`,
        });
        continue;
      }

      if (metrics.score > HEAVY_HANDLER_SCORE_THRESHOLDS.warning) {
        reporter.add({
          file: file.relativePath,
          line: route.line,
          col: 1,
          rule: 'C03',
          severity: 'warning',
          message: `路由 ${route.method} ${route.path} 流程较深（评分 ${metrics.score.toFixed(1)}，await ${metrics.awaitCount}，最大嵌套 ${metrics.maxDepth}）`,
        });
      }
    }
  },
};

export default [C01, C02, C03];
