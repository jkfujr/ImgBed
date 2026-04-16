import assert from 'node:assert/strict';
import test from 'node:test';

import {
  countChildDirectories,
  deleteDirectoryById,
  getAllDirectories,
  getChildDirectoriesByPathPrefix,
  getDirectoryByPath,
  insertDirectory,
  updateDirectoryNameAndPath,
  updateDirectoryPath,
} from '../../src/database/directories-dao.js';
import {
  countFilesByDirectoryPrefix,
  countActiveFiles,
  countImageFilesForMetadataRebuild,
  freezeFilesByMissingStorageInstances,
  freezeFilesByStorageInstance,
  getActiveFileById,
  getActiveFilesByIds,
  getActiveFilesStats,
  getFileById,
  getTodayUploadCount,
  getUploadTrend,
  insertAccessLog,
  insertFile,
  listImageFilesForMetadataRebuildAfter,
  listActiveFiles,
  moveFilesToDirectory,
  renameFileDirectory,
  updateActiveFileFields,
  updateFileImageMetadata,
  updateFileMigrationFields,
} from '../../src/database/files-dao.js';
import { serializeStorageMeta } from '../../src/utils/storage-meta.js';
import { createTestDb } from '../helpers/storage-test-helpers.mjs';

function buildFileRecord(overrides = {}) {
  return {
    id: overrides.id || 'file-1',
    file_name: overrides.file_name || 'demo.png',
    original_name: overrides.original_name || 'origin-demo.png',
    mime_type: overrides.mime_type || 'image/png',
    size: overrides.size ?? 123,
    storage_channel: overrides.storage_channel || 'local',
    storage_key: overrides.storage_key || 'storage-key',
    storage_meta: overrides.storage_meta ?? serializeStorageMeta({ deleteToken: { messageId: '1' } }),
    storage_instance_id: overrides.storage_instance_id || 'storage-1',
    upload_ip: overrides.upload_ip || '127.0.0.1',
    upload_address: overrides.upload_address || '{}',
    uploader_type: overrides.uploader_type || 'admin',
    uploader_id: overrides.uploader_id || 'admin',
    directory: overrides.directory || '/',
    tags: overrides.tags ?? null,
    is_public: overrides.is_public ?? 1,
    is_chunked: overrides.is_chunked ?? 0,
    chunk_count: overrides.chunk_count ?? 0,
    width: overrides.width === undefined ? 100 : overrides.width,
    height: overrides.height === undefined ? 200 : overrides.height,
    exif: overrides.exif ?? null,
    status: overrides.status || 'active',
  };
}

test('directories-dao 可以完成目录新增、子目录查询、重命名和删除', (t) => {
  const db = createTestDb();
  t.after(() => db.close());

  const rootResult = insertDirectory(db, {
    name: '图库',
    path: '/gallery',
    parentId: null,
  });
  const childResult = insertDirectory(db, {
    name: '旅行',
    path: '/gallery/travel',
    parentId: rootResult.lastInsertRowid,
  });

  assert.equal(getDirectoryByPath(db, '/gallery').name, '图库');
  assert.equal(countChildDirectories(db, rootResult.lastInsertRowid), 1);
  assert.equal(getChildDirectoriesByPathPrefix(db, '/gallery').length, 1);

  updateDirectoryNameAndPath(db, rootResult.lastInsertRowid, {
    name: '相册',
    path: '/albums',
  });
  updateDirectoryPath(db, childResult.lastInsertRowid, '/albums/travel');

  const allDirectories = getAllDirectories(db);
  assert.deepEqual(
    allDirectories.map((item) => item.path),
    ['/albums', '/albums/travel'],
  );

  deleteDirectoryById(db, childResult.lastInsertRowid);
  assert.equal(getChildDirectoriesByPathPrefix(db, '/albums').length, 0);
});

test('files-dao 可以完成文件插入、读取、统计与元数据更新', (t) => {
  const db = createTestDb();
  t.after(() => db.close());

  insertFile(db, buildFileRecord({
    id: 'file-a',
    directory: '/albums',
    size: 321,
  }));
  insertFile(db, buildFileRecord({
    id: 'file-b',
    directory: '/albums/travel',
    size: 99,
    width: null,
    height: null,
  }));

  assert.equal(getActiveFileById(db, 'file-a').file_name, 'demo.png');
  assert.equal(getFileById(db, 'file-b').directory, '/albums/travel');
  assert.equal(getActiveFilesByIds(db, ['file-a', 'file-b']).length, 2);
  assert.equal(countActiveFiles(db, { directory: '/albums' }), 1);
  assert.equal(listActiveFiles(db, {
    search: 'demo',
    limit: 10,
    offset: 0,
  }).length, 2);
  assert.deepEqual(getActiveFilesStats(db), { count: 2, sum: 420 });
  assert.equal(getTodayUploadCount(db), 2);
  assert.equal(getUploadTrend(db, 7).length, 1);
  assert.equal(countImageFilesForMetadataRebuild(db, false), 1);
  assert.deepEqual(listImageFilesForMetadataRebuildAfter(db, {
    force: false,
    limit: 10,
  }).map((item) => item.id), ['file-b']);

  updateFileImageMetadata(db, 'file-b', {
    width: 640,
    height: 480,
    exif: '{"camera":"demo"}',
  });
  updateActiveFileFields(db, 'file-b', {
    directory: '/albums',
    is_public: 0,
  });
  updateFileMigrationFields(db, 'file-a', {
    storageChannel: 's3',
    storageKey: 'migrated-key',
    storageMeta: serializeStorageMeta({ deleteToken: { messageId: '9' } }),
    storageInstanceId: 'storage-9',
    isChunked: 1,
    chunkCount: 3,
  });

  const migratedFile = getFileById(db, 'file-a');
  assert.equal(migratedFile.storage_channel, 's3');
  assert.equal(migratedFile.storage_instance_id, 'storage-9');
  assert.equal(getFileById(db, 'file-b').width, 640);
  assert.equal(getFileById(db, 'file-b').directory, '/albums');
  assert.equal(getFileById(db, 'file-b').is_public, 0);
  assert.equal(countImageFilesForMetadataRebuild(db, false), 0);
});

test('files-dao 可以完成目录迁移、冻结和访问日志写入', (t) => {
  const db = createTestDb();
  t.after(() => db.close());

  insertFile(db, buildFileRecord({
    id: 'file-1',
    directory: '/gallery',
    storage_instance_id: 'storage-a',
  }));
  insertFile(db, buildFileRecord({
    id: 'file-2',
    directory: '/gallery/travel',
    storage_instance_id: 'storage-b',
  }));
  insertFile(db, buildFileRecord({
    id: 'file-3',
    directory: '/gallery',
    storage_instance_id: 'storage-c',
  }));

  moveFilesToDirectory(db, ['file-1'], '/albums');
  renameFileDirectory(db, '/albums/travel', '/gallery/travel');

  assert.equal(getFileById(db, 'file-1').directory, '/albums');
  assert.equal(getFileById(db, 'file-2').directory, '/albums/travel');
  assert.equal(countFilesByDirectoryPrefix(db, '/albums'), 2);

  freezeFilesByStorageInstance(db, 'storage-a');
  freezeFilesByMissingStorageInstances(db, ['storage-b']);

  assert.equal(getFileById(db, 'file-1').status, 'channel_deleted');
  assert.equal(getFileById(db, 'file-2').status, 'active');
  assert.equal(getFileById(db, 'file-3').status, 'channel_deleted');

  insertAccessLog(db, {
    fileId: 'file-2',
    ip: '127.0.0.2',
    userAgent: 'node-test',
    referer: 'http://localhost',
    isAdmin: 0,
  });

  const logCount = db.prepare('SELECT COUNT(*) AS count FROM access_logs').get().count;
  assert.equal(logCount, 1);
});
