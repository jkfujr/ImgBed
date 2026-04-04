/**
 * 后端结构验证模块
 */
import path from 'node:path';
import { readText, expectPresent } from '../../shared/lib/assert.mjs';
import { runBackendRuleVerifications } from './verify-rule-upgrades.mjs';

const backendRoot = process.env.IMGBED_SRC_ROOT || path.join(process.cwd(), 'ImgBed');
const p = (...parts) => path.join(backendRoot, ...parts);

const checks = [
  {
    name: '后端启动入口保留数据库初始化',
    run() {
      const mainJs = readText(p('main.js'));
      expectPresent(mainJs, /initDb\(\);/, 'main.js 应在启动前执行 initDb()');
      expectPresent(mainJs, /fetch:\s*app\.fetch/, 'main.js 应通过 serve({ fetch: app.fetch }) 启动服务');
    },
  },
  {
    name: '后端应用保留核心路由挂载',
    run() {
      const appJs = readText(p('src', 'app.js'));
      expectPresent(appJs, /app\.route\('\/api\/auth', authRouter\);/, 'app.js 应挂载 /api/auth 路由');
      expectPresent(appJs, /app\.route\('\/api\/upload', uploadRouter\);/, 'app.js 应挂载 /api/upload 路由');
      expectPresent(appJs, /app\.route\('\/api\/files', filesRouter\);/, 'app.js 应挂载 /api/files 路由');
      expectPresent(appJs, /app\.route\('\/api\/directories', dirsRouter\);/, 'app.js 应挂载 /api/directories 路由');
      expectPresent(appJs, /app\.route\('\/api\/system', systemRouter\);/, 'app.js 应挂载 /api/system 路由');
    },
  },
  {
    name: '系统配置路由保留敏感保护',
    run() {
      const systemJs = readText(p('src', 'routes', 'system.js'));
      expectPresent(systemJs, /systemApp\.use\('\*', adminAuth\);/, 'system.js 应通过 adminAuth 保护全部路由');
      expectPresent(systemJs, /const SENSITIVE_KEYS = \[/, 'system.js 应维护敏感字段列表');
      expectPresent(systemJs, /function maskStorage\(s\)/, 'system.js 应保留 maskStorage 脱敏逻辑');
    },
  },
];

export function runAllVerifications() {
  let passed = 0;
  let failed = 0;
  const errors = [];

  console.log('\n后端结构验证');
  console.log('='.repeat(60));

  for (const check of checks) {
    try {
      check.run();
      passed++;
      console.log(`  \x1b[32m✓\x1b[0m ${check.name}`);
    } catch (err) {
      failed++;
      errors.push(`${check.name}: ${err.message}`);
      console.log(`  \x1b[31m✗\x1b[0m ${check.name}`);
      console.log(`    \x1b[31m${err.message}\x1b[0m`);
    }
  }

  const ruleVerificationResult = runBackendRuleVerifications();
  passed += ruleVerificationResult.passed;
  failed += ruleVerificationResult.failed;
  errors.push(...ruleVerificationResult.errors);

  console.log('-'.repeat(60));
  console.log(`验证完成: ${passed} 通过, ${failed} 失败 (共 ${checks.length + 3} 组)`);
  console.log('='.repeat(60));

  return { passed, failed, errors };
}

if (process.argv[1] && process.argv[1].includes('refactor-checks')) {
  const result = runAllVerifications();
  if (result.failed > 0) process.exit(1);
}
