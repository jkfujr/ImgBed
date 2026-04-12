import { strict as assert } from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';

import { parseStorageConfig } from '../ImgBed/src/services/files/storage-artifacts.js';
import {
  getEffectiveAdminPassword,
  verifyAdminCredentials,
} from '../ImgBed/src/services/auth/verify-credentials.js';

const ROOT = path.resolve('F:/Code/code/0x10_fork/ImgBed');

function read(relPath) {
  return fs.readFileSync(path.join(ROOT, relPath), 'utf8');
}

function makeDb({ row, throws = false } = {}) {
  return {
    prepare(sql) {
      return {
        get(key) {
          assert.match(sql, /SELECT value FROM system_settings WHERE key = \? LIMIT 1/);
          assert.equal(key, 'admin_password');
          if (throws) {
            throw new Error('db unavailable');
          }
          return row ?? undefined;
        },
      };
    },
  };
}

function testParseStorageConfigFallbacks() {
  assert.deepEqual(parseStorageConfig('{"a":1}'), { a: 1 });
  assert.deepEqual(parseStorageConfig(''), {});
  assert.deepEqual(parseStorageConfig('not-json'), {});
  console.log('  [OK] parseStorageConfig：保留空字符串/非法 JSON 的宽松回退');
}

async function testGetEffectiveAdminPasswordPrefersDb() {
  const password = await getEffectiveAdminPassword(makeDb({ row: { value: 'db-pass' } }), 'config-pass');
  assert.equal(password, 'db-pass');
  console.log('  [OK] getEffectiveAdminPassword：数据库密码优先');
}

async function testGetEffectiveAdminPasswordFallsBackToConfig() {
  const password = await getEffectiveAdminPassword(makeDb({ row: undefined }), 'config-pass');
  assert.equal(password, 'config-pass');
  console.log('  [OK] getEffectiveAdminPassword：数据库无值时回退配置');
}

async function testGetEffectiveAdminPasswordFallsBackOnDbError() {
  const password = await getEffectiveAdminPassword(makeDb({ throws: true }), 'config-pass');
  assert.equal(password, 'config-pass');
  console.log('  [OK] getEffectiveAdminPassword：数据库异常时回退配置');
}

async function testVerifyAdminCredentialsUsesEffectivePassword() {
  const ok = await verifyAdminCredentials(
    'admin',
    'db-pass',
    { username: 'admin', password: 'config-pass' },
    makeDb({ row: { value: 'db-pass' } }),
  );
  const fail = await verifyAdminCredentials(
    'admin',
    'config-pass',
    { username: 'admin', password: 'config-pass' },
    makeDb({ row: { value: 'db-pass' } }),
  );
  assert.equal(ok, true);
  assert.equal(fail, false);
  console.log('  [OK] verifyAdminCredentials：实际比较的是有效密码来源');
}

function testRecoverableErrorPatternsExist() {
  const source = read('ImgBed/main.js');
  assert.match(source, /const RECOVERABLE_ERROR_PATTERNS = \[/);
  assert.match(source, /'ECONNRESET'/);
  assert.match(source, /'ETIMEDOUT'/);
  assert.match(source, /'ENOTFOUND'/);
  assert.match(source, /process\.on\('uncaughtException', \(error\) => \{/);
  assert.match(source, /if \(isRecoverableError\(error\)\) \{/);
  assert.match(source, /process\.on\('unhandledRejection', \(reason, promise\) => \{/);
  console.log('  [OK] main.js：recoverable error 白名单与全局异常处理已接线');
}

function testSpaFallbackPrecedesNotFoundHandler() {
  const source = read('ImgBed/src/app.js');
  const staticIndex = source.indexOf("app.use(express.static(staticPath));");
  const fallbackIndex = source.indexOf("app.use((_req, res) => {");
  const notFoundIndex = source.indexOf('app.use(notFoundHandler);');

  assert.ok(staticIndex >= 0, '应存在静态资源服务');
  assert.ok(fallbackIndex > staticIndex, 'SPA fallback 应位于静态资源之后');
  assert.ok(notFoundIndex > fallbackIndex, 'notFoundHandler 应位于 SPA fallback 之后');
  assert.match(source, /res\.sendFile\(indexPath\);/);
  console.log('  [OK] app.js：SPA fallback 存在且位于 notFoundHandler 之前');
}

function testViewRouteHasLooseRefererPolicy() {
  const viewSource = read('ImgBed/src/routes/view.js');
  const configSource = read('ImgBed/src/config/index.js');

  assert.match(viewSource, /const allowed = security\.allowedDomains;/);
  assert.match(viewSource, /if \(!Array\.isArray\(allowed\) \|\| allowed\.length === 0\) \{/);
  assert.match(viewSource, /return true;/);
  assert.match(viewSource, /const referer = req\.get\('Referer'\) \|\| req\.get\('Origin'\);/);
  assert.match(viewSource, /if \(!referer\) \{/);

  assert.ok(!/allowedDomains\s*:/.test(configSource), '默认配置中不应存在 allowedDomains 字段');
  console.log('  [OK] view.js：空白名单放行且无 Referer/Origin 也放行');
}

async function main() {
  console.log('开始执行兼容性分支结构测试...');
  testParseStorageConfigFallbacks();
  await testGetEffectiveAdminPasswordPrefersDb();
  await testGetEffectiveAdminPasswordFallsBackToConfig();
  await testGetEffectiveAdminPasswordFallsBackOnDbError();
  await testVerifyAdminCredentialsUsesEffectivePassword();
  testRecoverableErrorPatternsExist();
  testSpaFallbackPrecedesNotFoundHandler();
  testViewRouteHasLooseRefererPolicy();
  console.log('兼容性分支结构测试全部通过');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
