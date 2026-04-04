/**
 * 验证外部静态检查接入
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..', '..', '..', 'ImgBed-web');

function read(relativePath) {
  return fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function testExternalChecksModuleExists() {
  const externalChecks = read('ImgBed-test/shared/lib/external-checks.mjs');

  assert(externalChecks.includes('export function runESLint'), 'external-checks.mjs 应导出 runESLint 函数');
  assert(externalChecks.includes('export function runTypeScript'), 'external-checks.mjs 应导出 runTypeScript 函数');
  assert(externalChecks.includes('export function runAllExternalChecks'), 'external-checks.mjs 应导出 runAllExternalChecks 函数');
  assert(externalChecks.includes('npm run ${scriptName}'), 'runESLint 应调用 npm run 脚本');
  assert(externalChecks.includes('npx tsc --noEmit'), 'runTypeScript 应支持 npx tsc --noEmit 回退命令');
  assert(externalChecks.includes('skipReason'), 'external-checks.mjs 应支持跳过检查并返回原因');

  return { name: 'external-checks.mjs 模块存在且包含必要函数', ok: true };
}

function testRunMjsIntegratesExternalChecks() {
  const runMjs = read('ImgBed-test/run.mjs');

  assert(runMjs.includes("from './shared/lib/external-checks.mjs'"), 'run.mjs 应导入 shared/lib/external-checks.mjs');
  assert(runMjs.includes('runAllExternalChecks'), 'run.mjs 应调用 runAllExternalChecks');
  assert(runMjs.includes('外部静态检查'), 'run.mjs 应输出外部静态检查标题');
  assert(runMjs.includes('externalResult'), 'run.mjs 应保存外部检查结果');
  assert(runMjs.includes('check.skipped'), 'run.mjs 应处理跳过的检查');
  assert(runMjs.includes('check.passed'), 'run.mjs 应处理通过的检查');
  assert(runMjs.includes('!item.externalResult.allPassed'), 'run.mjs 应在失败判定时考虑外部检查结果');

  return { name: 'run.mjs 已集成外部静态检查', ok: true };
}

function testReporterSupportsExternalChecks() {
  const reporter = read('ImgBed-test/shared/lib/reporter.mjs');

  assert(reporter.includes('externalChecks'), 'Reporter.toMarkdown 应接受 externalChecks 参数');
  assert(reporter.includes('外部静态检查'), 'Reporter.toMarkdown 应输出外部静态检查区块');

  return { name: 'Reporter 支持外部检查结果输出', ok: true };
}

function testExistingFeaturesNotBroken() {
  const runMjs = read('ImgBed-test/run.mjs');

  assert(runMjs.includes('--fix'), 'run.mjs 应保留 --fix 参数');
  assert(runMjs.includes('--dry-run'), 'run.mjs 应保留 --dry-run 参数');
  assert(runMjs.includes('--verify'), 'run.mjs 应保留 --verify 参数');
  assert(runMjs.includes('registry.run(files, reporter)'), 'run.mjs 应保留自研规则扫描');
  assert(runMjs.includes('fixer.run'), 'run.mjs 应保留自动修复逻辑');

  return { name: '现有功能未被破坏', ok: true };
}

async function main() {
  const tests = [
    testExternalChecksModuleExists,
    testRunMjsIntegratesExternalChecks,
    testReporterSupportsExternalChecks,
    testExistingFeaturesNotBroken,
  ];

  const results = [];
  for (const test of tests) {
    try {
      const result = await test();
      results.push(result);
      console.log(`✓ ${result.name}`);
    } catch (error) {
      results.push({ name: test.name, ok: false, error });
      console.log(`✗ ${test.name}`);
      console.log(`  ${error.message}`);
    }
  }

  const failed = results.filter((result) => !result.ok);
  console.log('');
  console.log(`结果: ${results.length - failed.length} 通过, ${failed.length} 失败, 共 ${results.length} 项`);

  if (failed.length > 0) {
    process.exit(1);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
