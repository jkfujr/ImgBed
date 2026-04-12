import { strict as assert } from 'node:assert';

import { loadFilesAdminPageData } from '../ImgBed-web/src/admin/filesAdminShared.js';

async function testDirectoryFailureDoesNotBlockFileList() {
  const result = await loadFilesAdminPageData({
    currentDir: '/',
    cached: {
      directories: [{ id: 1, path: '/cached', name: 'cached' }],
    },
    fetchDirectoriesImpl: async () => {
      throw new Error('proxy 502');
    },
    fetchListPageImpl: async () => ({
      data: [{ id: 100, file_name: 'demo.png' }],
      total: 1,
      hasMore: false,
    }),
    loggerImpl: {
      warn() {},
    },
  });

  assert.deepEqual(result.nextList, {
    data: [{ id: 100, file_name: 'demo.png' }],
    total: 1,
    hasMore: false,
    directories: [{ id: 1, path: '/cached', name: 'cached' }],
  });
  assert.equal(result.allDirs, null);
  console.log('  [OK] files-admin-load: directory failure does not block file list');
}

async function testListFailureStillRejects() {
  await assert.rejects(
    () => loadFilesAdminPageData({
      currentDir: '/',
      fetchDirectoriesImpl: async () => ({
        allDirs: [],
        directories: [],
      }),
      fetchListPageImpl: async () => {
        throw new Error('files failed');
      },
      loggerImpl: {
        warn() {},
      },
    }),
    /files failed/,
  );
  console.log('  [OK] files-admin-load: list failure still rejects');
}

async function main() {
  console.log('running files-admin-load tests...');
  await testDirectoryFailureDoesNotBlockFileList();
  await testListFailureStillRejects();
  console.log('files-admin-load tests passed');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
