/**
 * 后端规则验证补充脚本
 */
import path from 'node:path';
import { readText, expectPresent, expectAbsent } from '../../shared/lib/assert.mjs';
import { PATHS } from '../../shared/config/paths.mjs';

const rulesRoot = PATHS.test.backendRules;
const runPath = path.join(PATHS.testRoot, 'run.mjs');

const checks = [
  {
    name: 'A02 支持识别全局与细粒度权限保护',
    run() {
      const architecture = readText(path.join(rulesRoot, 'architecture.mjs'));
      expectPresent(architecture, /PUBLIC_ROUTE_EXCEPTIONS/, 'architecture.mjs 应包含公开接口例外配置');
      expectPresent(architecture, /GLOBAL_GUARD_PATTERN/, 'architecture.mjs 应识别全局中间件保护');
      expectPresent(architecture, /permission:upload:image/, 'architecture.mjs 应识别 upload:image 权限');
      expectPresent(architecture, /permission:files:read/, 'architecture.mjs 应识别 files:read 权限');
      expectPresent(architecture, /message:\s*`路由 \$\{route\.method\} \$\{route\.path\} 缺少期望的权限保护：\$\{expectedGuard\}`/, 'architecture.mjs 应输出精确的权限缺失信息');
      expectAbsent(architecture, /检测到写操作路由未显式使用 adminAuth 或 requirePermission 保护/, 'architecture.mjs 不应保留旧版单行匹配提示');
    },
  },
  {
    name: '复杂度规则支持分类型阈值与单处理器深度检测',
    run() {
      const complexity = readText(path.join(rulesRoot, 'complexity.mjs'));
      expectPresent(complexity, /FILE_TYPE_THRESHOLDS/, 'complexity.mjs 应定义按文件类型区分的阈值');
      expectPresent(complexity, /routeAggregator/, 'complexity.mjs 应包含 routeAggregator 类型');
      expectPresent(complexity, /routeSingleHeavy/, 'complexity.mjs 应包含 routeSingleHeavy 类型');
      expectPresent(complexity, /const C03 =/, 'complexity.mjs 应新增 C03 规则');
      expectPresent(complexity, /measureHandlerComplexity/, 'complexity.mjs 应包含单处理器复杂度评估');
    },
  },
  {
    name: '后端性能规则已接入统一入口',
    run() {
      const performance = readText(path.join(rulesRoot, 'performance.mjs'));
      const runMjs = readText(runPath);
      expectPresent(performance, /const P01 =/, 'performance.mjs 应定义 P01 规则');
      expectPresent(performance, /const P02 =/, 'performance.mjs 应定义 P02 规则');
      expectPresent(runMjs, /import\('\.\/backend\/rules\/performance\.mjs'\)/, 'run.mjs 应加载 backend performance 规则');
    },
  },
];

export function runBackendRuleVerifications() {
  let passed = 0;
  let failed = 0;
  const errors = [];

  console.log('\n后端规则验证');
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

  console.log('-'.repeat(60));
  console.log(`验证完成: ${passed} 通过, ${failed} 失败 (共 ${checks.length} 组)`);
  console.log('='.repeat(60));

  return { passed, failed, errors };
}

if (process.argv[1] && process.argv[1].includes('verify-rule-upgrades')) {
  const result = runBackendRuleVerifications();
  if (result.failed > 0) process.exit(1);
}
