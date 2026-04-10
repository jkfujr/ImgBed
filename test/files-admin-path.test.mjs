import { strict as assert } from 'node:assert';

const ROOT_DIR = '/';

function normalizeDirectoryPath(path) {
  const raw = `${path ?? ''}`.trim();
  if (!raw || raw === ROOT_DIR) return ROOT_DIR;

  const withLeadingSlash = raw.startsWith(ROOT_DIR) ? raw : `${ROOT_DIR}${raw}`;
  const collapsed = withLeadingSlash.replace(/\/+/g, ROOT_DIR);
  const trimmed = collapsed.replace(/\/+$|\/+$/g, '');

  return trimmed || ROOT_DIR;
}

function getDirectoryPathFromSearch(search) {
  const params = new URLSearchParams(search);
  return normalizeDirectoryPath(params.get('path'));
}

function buildFilesAdminPath(dir) {
  const normalized = normalizeDirectoryPath(dir);
  return `/admin/files?path=${encodeURIComponent(normalized)}`;
}

function getCacheKey(dir) {
  return normalizeDirectoryPath(dir);
}

function run() {
  assert.equal(normalizeDirectoryPath(''), ROOT_DIR);
  assert.equal(normalizeDirectoryPath('/'), ROOT_DIR);
  assert.equal(normalizeDirectoryPath('QQ'), '/QQ');
  assert.equal(normalizeDirectoryPath('/QQ/'), '/QQ');
  assert.equal(normalizeDirectoryPath('//QQ//子目录///'), '/QQ/子目录');

  assert.equal(getDirectoryPathFromSearch(''), ROOT_DIR);
  assert.equal(getDirectoryPathFromSearch('?path='), ROOT_DIR);
  assert.equal(getDirectoryPathFromSearch('?path=QQ'), '/QQ');
  assert.equal(getDirectoryPathFromSearch('?path=%2FQQ%2F子目录%2F'), '/QQ/子目录');

  assert.equal(buildFilesAdminPath(ROOT_DIR), '/admin/files?path=%2F');
  assert.equal(buildFilesAdminPath('/QQ/子目录/'), '/admin/files?path=%2FQQ%2F%E5%AD%90%E7%9B%AE%E5%BD%95');

  assert.equal(getCacheKey('/QQ/'), '/QQ');
  assert.equal(getCacheKey('/QQ'), '/QQ');

  console.log('路径规范化测试通过');
}

run();
