/**
 * A 类规则: Architecture — 后端结构约束
 * A01-A03
 */

const CORE_ROUTE_ASSERTIONS = [
  { path: 'src/app.js', pattern: "app.route('/api/auth', authRouter);", message: 'app.js 应挂载 /api/auth 路由' },
  { path: 'src/app.js', pattern: "app.route('/api/upload', uploadRouter);", message: 'app.js 应挂载 /api/upload 路由' },
  { path: 'src/app.js', pattern: "app.route('/api/files', filesRouter);", message: 'app.js 应挂载 /api/files 路由' },
  { path: 'src/app.js', pattern: "app.route('/api/directories', dirsRouter);", message: 'app.js 应挂载 /api/directories 路由' },
  { path: 'src/app.js', pattern: "app.route('/api/system', systemRouter);", message: 'app.js 应挂载 /api/system 路由' },
  { path: 'main.js', pattern: 'initDb();', message: 'main.js 应在启动前执行 initDb()' },
  { path: 'main.js', pattern: 'fetch: app.fetch,', message: 'main.js 应通过 serve({ fetch: app.fetch }) 启动服务' },
];

const PUBLIC_ROUTE_EXCEPTIONS = new Set([
  'src/routes/auth.js|POST|/login',
]);

const EXPECTED_ROUTE_GUARDS = [
  { file: 'src/routes/upload.js', method: 'POST', path: '/', expected: 'permission:upload:image' },
  { file: 'src/routes/files.js', method: 'GET', path: '/', expected: 'permission:files:read' },
  { file: 'src/routes/files.js', method: 'GET', path: '/:id', expected: 'permission:files:read' },
  { file: 'src/routes/files.js', method: 'PUT', path: '/:id', expected: 'admin' },
  { file: 'src/routes/files.js', method: 'DELETE', path: '/:id', expected: 'admin' },
  { file: 'src/routes/files.js', method: 'POST', path: '/batch', expected: 'admin' },
  { file: 'src/routes/files.js', method: 'POST', path: '/maintenance/rebuild-metadata', expected: 'permission:admin' },
];

const ADMIN_GUARD_FILES = new Set([
  'src/routes/directories.js',
  'src/routes/api-tokens.js',
  'src/routes/system.js',
]);

const ROUTE_METHOD_PATTERN = /([A-Za-z_$][\w$]*)\.(get|post|put|delete|patch)\s*\(/g;
const GLOBAL_GUARD_PATTERN = /([A-Za-z_$][\w$]*)\.use\(\s*['"]\*['"]\s*,\s*([^\n]+?)\s*\);/g;

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

function getLineNumber(content, index) {
  return content.slice(0, index).split('\n').length;
}

function normalizeGuard(token) {
  const value = token.trim();
  if (!value) return null;
  if (/\badminAuth\b/.test(value)) return 'admin';
  if (/\brequireAuth\b/.test(value)) return 'auth';

  const permissionMatch = value.match(/requirePermission\(\s*['"]([^'"]+)['"]\s*\)/);
  if (permissionMatch) {
    return `permission:${permissionMatch[1]}`;
  }

  return null;
}

function getGlobalGuards(content) {
  const guardsByApp = new Map();
  for (const match of content.matchAll(GLOBAL_GUARD_PATTERN)) {
    const appName = match[1];
    const guard = normalizeGuard(match[2]);
    if (!guard) continue;
    if (!guardsByApp.has(appName)) {
      guardsByApp.set(appName, []);
    }
    guardsByApp.get(appName).push(guard);
  }
  return guardsByApp;
}

function getRouteDefinitions(file) {
  const routes = [];
  const content = file.content;

  for (const match of content.matchAll(ROUTE_METHOD_PATTERN)) {
    const appName = match[1];
    const method = match[2].toUpperCase();
    const openParenIndex = match.index + match[0].length - 1;
    const closeParenIndex = findClosingParen(content, openParenIndex);
    if (closeParenIndex === -1) continue;

    const argsText = content.slice(openParenIndex + 1, closeParenIndex);
    const args = splitTopLevelArgs(argsText);
    if (args.length < 2) continue;

    const pathArg = args[0].trim();
    const routePathMatch = pathArg.match(/^['"]([^'"]+)['"]$/);
    if (!routePathMatch) continue;

    const middlewares = args.slice(1, -1).map(normalizeGuard).filter(Boolean);
    routes.push({
      appName,
      method,
      path: routePathMatch[1],
      line: getLineNumber(content, match.index),
      guards: middlewares,
    });
  }

  return routes;
}

function getExpectedGuard(file, route) {
  if (ADMIN_GUARD_FILES.has(file.relativePath)) {
    return 'admin';
  }

  const matched = EXPECTED_ROUTE_GUARDS.find((item) => (
    item.file === file.relativePath && item.method === route.method && item.path === route.path
  ));

  return matched ? matched.expected : null;
}

function isPublicException(file, route) {
  return PUBLIC_ROUTE_EXCEPTIONS.has(`${file.relativePath}|${route.method}|${route.path}`);
}

function hasGuard(guards, expected) {
  if (!expected) return guards.length > 0;
  if (expected === 'admin') return guards.includes('admin');
  if (expected === 'auth') return guards.includes('auth') || guards.includes('admin');
  if (expected === 'permission:admin') {
    return guards.includes('permission:admin') || guards.includes('admin');
  }
  if (expected.startsWith('permission:')) {
    return guards.includes(expected) || guards.includes('admin');
  }
  return guards.includes(expected);
}

const A01 = {
  code: 'A01',
  name: '核心路由与启动结构缺失',
  category: 'architecture',
  severity: 'error',
  description: '后端入口应保留核心路由挂载、数据库初始化和 Hono 启动结构',
  check(file, reporter) {
    for (const assertion of CORE_ROUTE_ASSERTIONS) {
      if (file.relativePath !== assertion.path) continue;
      if (!file.content.includes(assertion.pattern)) {
        reporter.add({
          file: file.relativePath,
          line: 1,
          col: 0,
          rule: 'A01',
          severity: 'error',
          message: assertion.message,
        });
      }
    }
  },
};

const A02 = {
  code: 'A02',
  name: '写操作缺少权限保护',
  category: 'architecture',
  severity: 'warning',
  description: '后端写操作路由应使用合适的全局或局部权限保护，合法公开接口除外',
  check(file, reporter) {
    if (!file.relativePath.startsWith('src/routes/')) return;

    const globalGuards = getGlobalGuards(file.content);
    const routes = getRouteDefinitions(file);

    for (const route of routes) {
      if (isPublicException(file, route)) continue;

      const effectiveGuards = [
        ...(globalGuards.get(route.appName) || []),
        ...route.guards,
      ];

      const expectedGuard = getExpectedGuard(file, route);
      const isWriteRoute = ['POST', 'PUT', 'DELETE', 'PATCH'].includes(route.method);

      if (expectedGuard) {
        if (!hasGuard(effectiveGuards, expectedGuard)) {
          reporter.add({
            file: file.relativePath,
            line: route.line,
            col: 1,
            rule: 'A02',
            severity: expectedGuard === 'admin' ? 'error' : 'warning',
            message: `路由 ${route.method} ${route.path} 缺少期望的权限保护：${expectedGuard}`,
          });
        }
        continue;
      }

      if (isWriteRoute && effectiveGuards.length === 0) {
        reporter.add({
          file: file.relativePath,
          line: route.line,
          col: 1,
          rule: 'A02',
          severity: 'warning',
          message: `检测到写操作路由 ${route.method} ${route.path} 未配置任何权限保护`,
        });
      }
    }
  },
};

const A03 = {
  code: 'A03',
  name: '系统配置路由缺少敏感保护',
  category: 'architecture',
  severity: 'error',
  description: 'system 路由应保留敏感字段脱敏与管理员权限保护',
  check(file, reporter) {
    if (file.relativePath !== 'src/routes/system.js') return;

    const assertions = [
      { pattern: "systemApp.use('*', adminAuth);", message: 'system.js 应通过 adminAuth 保护全部路由' },
      { pattern: 'const SENSITIVE_KEYS =', message: 'system.js 应维护敏感字段列表' },
      { pattern: 'function maskStorage(s)', message: 'system.js 应保留 maskStorage 脱敏逻辑' },
      { pattern: 'fs.writeFileSync(configPath, JSON.stringify(cfg, null, 2), \'utf8\');', message: 'system.js 应显式写回 config.json 配置文件' },
    ];

    for (const assertion of assertions) {
      if (!file.content.includes(assertion.pattern)) {
        reporter.add({
          file: file.relativePath,
          line: 1,
          col: 0,
          rule: 'A03',
          severity: 'error',
          message: assertion.message,
        });
      }
    }
  },
};

export default [A01, A02, A03];
