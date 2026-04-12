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

function testRequireAuthIsUnusedExport() {
  const authSource = read('ImgBed/src/middleware/auth.js');
  assert.match(authSource, /const requireAuth = async \(req, res, next\) => \{/);
  assert.match(authSource, /export \{[\s\S]*requireAuth,[\s\S]*\};/);

  const files = collectJsFiles(SRC_ROOT).filter((file) => !file.endsWith(path.join('middleware', 'auth.js')));
  const hits = files.filter((file) => fs.readFileSync(file, 'utf8').includes('requireAuth'));
  assert.deepEqual(hits, [], '除定义文件外不应存在 requireAuth 使用点');
  console.log('  [OK] requireAuth：仅定义并导出，未进入调用闭环');
}

function testDeleteStorageChannelMetaIsUnusedExport() {
  const syncSource = read('ImgBed/src/services/system/storage-channel-sync.js');
  const runtimeSource = read('ImgBed/src/bootstrap/application-runtime.js');
  const systemSource = read('ImgBed/src/routes/system.js');
  const mainSource = read('ImgBed/main.js');

  assert.match(syncSource, /function deleteStorageChannelMeta\(id, db\) \{/);
  assert.match(syncSource, /export \{[\s\S]*deleteStorageChannelMeta,[\s\S]*\};/);
  assert.match(systemSource, /markStorageChannelDeleted\(id, sqlite\);/);
  assert.match(mainSource, /createApplicationRuntime/);
  assert.match(mainSource, /syncAllStorageChannels,/);
  assert.match(runtimeSource, /await syncAllStorageChannels\(runtimeConfig, sqlite\);/);

  const files = collectJsFiles(SRC_ROOT).filter((file) => !file.endsWith(path.join('services', 'system', 'storage-channel-sync.js')));
  const hits = files.filter((file) => fs.readFileSync(file, 'utf8').includes('deleteStorageChannelMeta'));
  assert.deepEqual(hits, [], '除定义文件外不应存在 deleteStorageChannelMeta 使用点');
  console.log('  [OK] deleteStorageChannelMeta：未被调用，删除链实际走 markStorageChannelDeleted');
}

function testNormalizePermissionsImportIsUnused() {
  const source = read('ImgBed/src/routes/api-tokens.js');
  assert.match(source, /normalizePermissions,/);
  assert.equal(countOccurrences(source, 'normalizePermissions'), 1, 'normalizePermissions 只应在 import 中出现一次');
  assert.match(source, /permissions: parsePermissions\(tokenRow\.permissions\),/);
  console.log('  [OK] normalizePermissions：在 api-tokens.js 中属于未使用导入');
}

function testResponseErrorIsUnusedExport() {
  const responseSource = read('ImgBed/src/utils/response.js');
  assert.match(responseSource, /export const error = \(code, message\) => \(\{/);

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
  console.log('  [OK] response.error：仅导出，未发现显式导入或 namespace 使用');
}

function run() {
  console.log('开始执行报告死代码静态断言测试...');
  testRequireAuthIsUnusedExport();
  testDeleteStorageChannelMetaIsUnusedExport();
  testNormalizePermissionsImportIsUnused();
  testResponseErrorIsUnusedExport();
  console.log('报告死代码静态断言测试全部通过');
}

run();
