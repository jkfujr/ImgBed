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

function resolveCreateButtonDir(pathname, search) {
  if (pathname !== '/admin/files') {
    return ROOT_DIR;
  }
  return getDirectoryPathFromSearch(search);
}

function resolveCreateFolderOptions(currentDir) {
  return currentDir === ROOT_DIR
    ? { parentId: null }
    : { currentPath: currentDir };
}

function resolveUploadOptions(currentDir, options = {}) {
  return { ...options, directory: normalizeDirectoryPath(currentDir) };
}

function run() {
  const filesDir = resolveCreateButtonDir('/admin/files', '?path=%2FQQ');
  assert.equal(filesDir, '/QQ');
  assert.deepEqual(resolveUploadOptions(filesDir, { uploadPassword: 'x' }), {
    uploadPassword: 'x',
    directory: '/QQ',
  });
  assert.deepEqual(resolveCreateFolderOptions(filesDir), { currentPath: '/QQ' });

  const rootDir = resolveCreateButtonDir('/admin/files', '');
  assert.equal(rootDir, ROOT_DIR);
  assert.deepEqual(resolveCreateFolderOptions(rootDir), { parentId: null });

  const nonFilesDir = resolveCreateButtonDir('/admin/settings', '?path=%2FQQ');
  assert.equal(nonFilesDir, ROOT_DIR);
  assert.deepEqual(resolveUploadOptions(nonFilesDir), { directory: ROOT_DIR });

  console.log('顶部新建目录联动测试通过');
}

run();
