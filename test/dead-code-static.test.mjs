import { strict as assert } from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve('F:/Code/code/0x10_fork/ImgBed');
const SRC_ROOT = path.join(ROOT, 'ImgBed', 'src');

function read(relPath) {
  return fs.readFileSync(path.join(ROOT, relPath), 'utf8');
}

function collectJsFiles(dir) {
  const result = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      result.push(...collectJsFiles(full));
    } else if (entry.isFile() && full.endsWith('.js')) {
      result.push(full);
    }
  }
  return result;
}

function countOccurrences(haystack, needle) {
  const matches = haystack.match(new RegExp(needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'));
  return matches ? matches.length : 0;
}

function testRequireAuthHasBeenRemoved() {
  const authSource = read('ImgBed/src/middleware/auth.js');
  assert.doesNotMatch(authSource, /const requireAuth = async \(req, res, next\) => \{/, 'requireAuth 实现应已删除');
  assert.doesNotMatch(authSource, /export \{[\s\S]*requireAuth,[\s\S]*\};/, 'requireAuth 导出应已删除');

  const files = collectJsFiles(SRC_ROOT);
  const hits = files.filter((file) => fs.readFileSync(file, 'utf8').includes('requireAuth'));
  assert.deepEqual(hits, [], '源码中不应再存在 requireAuth');
  console.log('  [OK] requireAuth：已从源码中移除');
}

function testDeleteStorageChannelMetaHasBeenRemoved() {
  const syncSource = read('ImgBed/src/services/system/storage-channel-sync.js');
  const runtimeSource = read('ImgBed/src/bootstrap/application-runtime.js');
  const systemSource = read('ImgBed/src/routes/system.js');
  const mainSource = read('ImgBed/main.js');

  assert.doesNotMatch(syncSource, /function deleteStorageChannelMeta\(id, db\) \{/, 'deleteStorageChannelMeta 实现应已删除');
  assert.doesNotMatch(syncSource, /export \{[\s\S]*deleteStorageChannelMeta,[\s\S]*\};/, 'deleteStorageChannelMeta 导出应已删除');
  assert.match(systemSource, /markStorageChannelDeleted\(id, sqlite\);/);
  assert.match(mainSource, /createApplicationRuntime/);
  assert.match(mainSource, /syncAllStorageChannels,/);
  assert.match(runtimeSource, /await syncAllStorageChannels\(runtimeConfig, sqlite\);/);

  const files = collectJsFiles(SRC_ROOT);
  const hits = files.filter((file) => fs.readFileSync(file, 'utf8').includes('deleteStorageChannelMeta'));
  assert.deepEqual(hits, [], '源码中不应再存在 deleteStorageChannelMeta');
  console.log('  [OK] deleteStorageChannelMeta：已从源码中移除，删除链仍走 markStorageChannelDeleted');
}

function testNormalizePermissionsUnusedImportHasBeenRemoved() {
  const source = read('ImgBed/src/routes/api-tokens.js');
  assert.doesNotMatch(source, /normalizePermissions,/, 'api-tokens.js 不应再导入 normalizePermissions');
  assert.equal(countOccurrences(source, 'normalizePermissions'), 0, 'api-tokens.js 中不应再出现 normalizePermissions');
  assert.match(source, /permissions: parsePermissions\(tokenRow\.permissions\),/);
  console.log('  [OK] normalizePermissions：未使用导入已移除');
}

function testResponseErrorHasBeenRemoved() {
  const responseSource = read('ImgBed/src/utils/response.js');
  assert.doesNotMatch(responseSource, /export const error = \(code, message\) => \(\{/, 'response.error 导出应已删除');

  const files = collectJsFiles(SRC_ROOT).filter((file) => !file.endsWith(path.join('utils', 'response.js')));
  const directImportHits = [];
  const namespaceHits = [];

  for (const file of files) {
    const source = fs.readFileSync(file, 'utf8');
    const importsResponse = source.includes("../utils/response.js") || source.includes("../../utils/response.js") || source.includes("./utils/response.js");
    if (!importsResponse) continue;

    if (/import\s*\{[^}]*\berror\b[^}]*\}\s*from\s*['"][^'"]*utils\/response\.js['"]/.test(source)) {
      directImportHits.push(file);
    }
    if (/import\s*\*\s*as\s+\w+\s+from\s*['"][^'"]*utils\/response\.js['"]/.test(source)) {
      namespaceHits.push(file);
    }
  }

  assert.deepEqual(directImportHits, [], '不应存在对 response.error 的显式导入');
  assert.deepEqual(namespaceHits, [], '不应存在 response.js 的 namespace import');
  console.log('  [OK] response.error：未使用导出已移除');
}

function run() {
  console.log('开始执行 P0 死代码清理静态断言测试...');
  testRequireAuthHasBeenRemoved();
  testDeleteStorageChannelMetaHasBeenRemoved();
  testNormalizePermissionsUnusedImportHasBeenRemoved();
  testResponseErrorHasBeenRemoved();
  console.log('P0 死代码清理静态断言测试全部通过');
}

run();
