import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import test from 'node:test';

import { insertDirectory } from '../../src/database/directories-dao.js';
import { insertFile, getFileById } from '../../src/database/files-dao.js';
import {
  createStorageManagerDouble,
  createTestDb,
  getQuotaEvents,
  getStorageOperation,
  insertFileRecord,
} from '../helpers/storage-test-helpers.mjs';
import {
  createTempAppRoot,
  resolveProjectModuleUrl,
} from '../helpers/runtime-test-helpers.mjs';

const appRoot = createTempAppRoot('imgbed-04-files-');
process.env.IMGBED_APP_ROOT = appRoot;

const configModule = await import(resolveProjectModuleUrl('src', 'config', 'index.js'));
configModule.loadStartupConfig();

const { deleteFileRecord, deleteFilesBatch } = await import(resolveProjectModuleUrl('src', 'services', 'files', 'delete-file.js'));
const { executeFilesBatchAction } = await import(resolveProjectModuleUrl('src', 'services', 'files', 'batch-action.js'));
const { migrateFileRecord, validateMigrationTarget } = await import(resolveProjectModuleUrl('src', 'services', 'files', 'migrate-file.js'));
const { rebuildMetadataTask } = await import(resolveProjectModuleUrl('src', 'services', 'files', 'rebuild-metadata.js'));

function buildFileRecord(overrides = {}) {
  return {
    id: overrides.id || 'file-1',
    file_name: overrides.file_name || 'demo.png',
    original_name: overrides.original_name || 'origin-demo.png',
    mime_type: overrides.mime_type || 'image/png',
    size: overrides.size ?? 123,
    storage_channel: overrides.storage_channel || 'local',
    storage_key: overrides.storage_key || 'storage-key',
    storage_meta: overrides.storage_meta ?? null,
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
    width: overrides.width === undefined ? null : overrides.width,
    height: overrides.height === undefined ? null : overrides.height,
    exif: overrides.exif ?? null,
    status: overrides.status || 'active',
  };
}

function createMigrationStorageManager({ sourceBuffer = Buffer.from('demo') } = {}) {
  const calls = {
    sourceDeletes: [],
    targetPuts: [],
    applyPendingQuotaEvents: [],
  };

  const sourceStorage = {
    async getStreamResponse(storageKey) {
      return {
        stream: Readable.from([sourceBuffer]),
      };
    },
    async delete(storageKey, deleteToken) {
      calls.sourceDeletes.push({ storageKey, deleteToken });
      return true;
    },
    getChunkConfig() {
      return {
        enabled: false,
        chunkThreshold: Number.MAX_SAFE_INTEGER,
        chunkSize: 1024 * 1024,
        maxChunks: 100,
      };
    },
  };

  const targetStorage = {
    async put(stream, meta) {
      const chunks = [];
      for await (const chunk of stream) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      }
      calls.targetPuts.push({
        meta,
        body: Buffer.concat(chunks).toString('utf8'),
      });
      return {
        storageKey: 'target-key',
        size: Buffer.concat(chunks).length,
        deleteToken: { messageId: '9' },
      };
    },
    getChunkConfig() {
      return {
        enabled: false,
        chunkThreshold: Number.MAX_SAFE_INTEGER,
        chunkSize: 1024 * 1024,
        maxChunks: 100,
      };
    },
  };

  const metas = {
    'source-1': {
      id: 'source-1',
      type: 'local',
      instance: sourceStorage,
    },
    'target-1': {
      id: 'target-1',
      type: 's3',
      instance: targetStorage,
    },
  };

  return {
    calls,
    manager: {
      getStorageMeta(storageId) {
        return metas[storageId] || null;
      },
      getStorage(storageId) {
        return metas[storageId]?.instance || null;
      },
      isUploadAllowed(storageId) {
        return storageId === 'target-1';
      },
      getEffectiveUploadLimits() {
        return {
          enableMaxLimit: false,
          maxLimitMB: 20,
          enableSizeLimit: false,
          sizeLimitMB: 20,
          enableChunking: false,
          chunkSizeMB: 5,
          maxChunks: 10,
        };
      },
      async applyPendingQuotaEvents(options) {
        calls.applyPendingQuotaEvents.push(options);
        return {
          applied: 2,
          storageIds: ['source-1', 'target-1'],
        };
      },
    },
  };
}

test('validateMigrationTarget 会覆盖 400、404、403 边界', () => {
  assert.throws(
    () => validateMigrationTarget('', {
      getStorageMeta() {
        return null;
      },
      isUploadAllowed() {
        return false;
      },
    }),
    (error) => error.status === 400 && /target_channel/.test(error.message),
  );

  assert.throws(
    () => validateMigrationTarget('missing-target', {
      getStorageMeta() {
        return null;
      },
      isUploadAllowed() {
        return false;
      },
    }),
    (error) => error.status === 404 && /目标渠道不存在/.test(error.message),
  );

  assert.throws(
    () => validateMigrationTarget('target-readonly', {
      getStorageMeta() {
        return {
          id: 'target-readonly',
          type: 's3',
        };
      },
      isUploadAllowed() {
        return false;
      },
    }),
    (error) => error.status === 403 && /不支持写入/.test(error.message),
  );

  assert.throws(
    () => validateMigrationTarget('target-webdav', {
      getStorageMeta() {
        return {
          id: 'target-webdav',
          type: 'webdav',
        };
      },
      isUploadAllowed() {
        return true;
      },
    }),
    (error) => error.status === 403 && /不支持作为迁移目标/.test(error.message),
  );
});

test('deleteFileRecord 在 index_only 模式下会删除索引与 chunks，但不会触发远端删除', async (t) => {
  const db = createTestDb();
  t.after(() => db.close());

  insertFileRecord(db, {
    id: 'file-delete-index-only',
    fileName: 'delete-index-only.png',
    storageKey: 'remote-key',
    storageInstanceId: 'storage-delete',
    isChunked: 1,
    chunkCount: 1,
    size: 12,
  });
  db.prepare(`
    INSERT INTO chunks (
      file_id, chunk_index, storage_type, storage_id, storage_key, storage_meta, size
    ) VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run('file-delete-index-only', 0, 'mock', 'storage-delete', 'chunk-0', null, 12);

  const { manager, calls } = createStorageManagerDouble();

  await deleteFileRecord(getFileById(db, 'file-delete-index-only'), {
    db,
    storageManager: manager,
    applyPendingQuotaEvents: manager.applyPendingQuotaEvents,
    deleteMode: 'index_only',
  });

  assert.equal(getFileById(db, 'file-delete-index-only'), undefined);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM chunks WHERE file_id = ?').get('file-delete-index-only').count, 0);
  assert.equal(calls.deleteCalls.length, 0);
  assert.equal(calls.applyQuotaCalls.length, 1);

  const operation = getStorageOperation(db, db.prepare('SELECT id FROM storage_operations LIMIT 1').get().id);
  const quotaEvents = getQuotaEvents(db, operation.id);
  assert.equal(operation.status, 'completed');
  assert.equal(quotaEvents[0].event_type, 'delete');
  assert.equal(quotaEvents[0].bytes_delta, -12);
});

test('deleteFilesBatch 会聚合成功与失败结果', async (t) => {
  const db = createTestDb();
  t.after(() => db.close());

  insertFileRecord(db, {
    id: 'file-delete-ok',
    storageKey: 'ok-key',
    storageInstanceId: 'storage-a',
  });
  insertFileRecord(db, {
    id: 'file-delete-bad',
    storageKey: 'bad-key',
    storageInstanceId: 'storage-a',
  });

  const { manager } = createStorageManagerDouble({
    deleteImpl(call) {
      return call.storageKey !== 'bad-key';
    },
  });

  const results = await deleteFilesBatch([
    getFileById(db, 'file-delete-ok'),
    getFileById(db, 'file-delete-bad'),
  ], {
    db,
    storageManager: manager,
    applyPendingQuotaEvents: manager.applyPendingQuotaEvents,
    deleteMode: 'remote_and_index',
  });

  assert.deepEqual(results, {
    total: 2,
    success: 1,
    failed: 1,
    errors: [
      {
        id: 'file-delete-bad',
        reason: '存储对象删除失败: bad-key',
      },
    ],
  });
});

test('migrateFileRecord 在非分块成功路径下会更新文件、记录配额事件并清理源对象', async (t) => {
  const db = createTestDb();
  t.after(() => db.close());

  insertFileRecord(db, {
    id: 'file-migrate-1',
    fileName: 'migrate-1.png',
    originalName: 'migrate-1.png',
    size: 4,
    storageChannel: 'local',
    storageKey: 'source-key',
    storageInstanceId: 'source-1',
    deleteToken: { messageId: '1' },
  });

  const { manager, calls } = createMigrationStorageManager({
    sourceBuffer: Buffer.from('demo'),
  });

  const result = await migrateFileRecord(getFileById(db, 'file-migrate-1'), {
    targetChannel: 'target-1',
    targetEntry: manager.getStorageMeta('target-1'),
    db,
    storageManager: manager,
    applyPendingQuotaEvents: manager.applyPendingQuotaEvents,
  });

  assert.deepEqual(result, { status: 'success' });

  const migrated = getFileById(db, 'file-migrate-1');
  assert.equal(migrated.storage_channel, 's3');
  assert.equal(migrated.storage_key, 'target-key');
  assert.equal(migrated.storage_instance_id, 'target-1');
  assert.equal(migrated.is_chunked, 0);
  assert.deepEqual(calls.targetPuts, [
    {
      meta: {
        id: 'file-migrate-1',
        fileName: 'migrate-1.png',
        originalName: 'migrate-1.png',
        mimeType: 'image/png',
        contentLength: 4,
      },
      body: 'demo',
    },
  ]);
  assert.deepEqual(calls.sourceDeletes, [
    {
      storageKey: 'source-key',
      deleteToken: { messageId: '1' },
    },
  ]);

  const operationId = db.prepare('SELECT id FROM storage_operations LIMIT 1').get().id;
  const operation = getStorageOperation(db, operationId);
  const quotaEvents = getQuotaEvents(db, operationId);

  assert.equal(operation.status, 'completed');
  assert.deepEqual(
    quotaEvents.map((item) => ({
      type: item.event_type,
      storageId: item.storage_id,
      bytes: item.bytes_delta,
      count: item.file_count_delta,
    })),
    [
      { type: 'migrate_out', storageId: 'source-1', bytes: -4, count: -1 },
      { type: 'migrate_in', storageId: 'target-1', bytes: 4, count: 1 },
    ],
  );
});

test('executeFilesBatchAction 的 move 分支会规范化目录并更新文件位置', async (t) => {
  const db = createTestDb();
  t.after(() => db.close());

  insertDirectory(db, {
    name: '图库',
    path: '/gallery',
    parentId: null,
  });
  insertFile(db, buildFileRecord({
    id: 'file-move-1',
    directory: '/',
  }));

  const result = await executeFilesBatchAction({
    action: 'move',
    ids: ['file-move-1'],
    targetDirectory: 'gallery',
    db,
    storageManager: {},
  });

  assert.equal(result.code, 0);
  assert.match(result.message, /\/gallery/);
  assert.equal(getFileById(db, 'file-move-1').directory, '/gallery');
});

test('executeFilesBatchAction 的 migrate 分支会通过注入 fileMigrationService 分发并聚合结果', async (t) => {
  const db = createTestDb();
  t.after(() => db.close());

  insertFileRecord(db, {
    id: 'file-batch-migrate-1',
    storageKey: 'source-key-1',
    storageInstanceId: 'source-1',
  });
  insertFileRecord(db, {
    id: 'file-batch-migrate-2',
    storageKey: 'source-key-2',
    storageInstanceId: 'source-1',
  });

  const calls = [];
  const fileMigrationService = {
    async migrateFilesBatch(files, options) {
      calls.push({
        files: files.map((item) => item.id),
        options,
      });
      return {
        total: 2,
        success: 1,
        failed: 0,
        skipped: 1,
        errors: [],
      };
    },
  };

  const result = await executeFilesBatchAction({
    action: 'migrate',
    ids: ['file-batch-migrate-1', 'file-batch-migrate-2'],
    targetChannel: 'target-1',
    db,
    storageManager: null,
    fileMigrationService,
  });

  assert.deepEqual(calls, [{
    files: ['file-batch-migrate-1', 'file-batch-migrate-2'],
    options: {
      targetChannel: 'target-1',
    },
  }]);
  assert.deepEqual(result, {
    code: 0,
    message: '迁移完成：成功 1，失败 0，跳过 1',
    data: {
      total: 2,
      success: 1,
      failed: 0,
      skipped: 1,
      errors: [],
    },
  });
});

test('rebuildMetadataTask 会统计 updated、skipped、failed 三类结果', async (t) => {
  const db = createTestDb();
  t.after(() => db.close());

  insertFile(db, buildFileRecord({
    id: 'file-meta-ok',
    storage_key: 'ok-key',
    storage_instance_id: 'storage-ok',
  }));
  insertFile(db, buildFileRecord({
    id: 'file-meta-missing',
    storage_key: 'missing-key',
    storage_instance_id: 'storage-missing',
  }));
  insertFile(db, buildFileRecord({
    id: 'file-meta-fail',
    storage_key: 'fail-key',
    storage_instance_id: 'storage-fail',
  }));

  const logger = {
    logs: [],
    warns: [],
    errors: [],
    log(...args) {
      this.logs.push(args);
    },
    warn(...args) {
      this.warns.push(args);
    },
    error(...args) {
      this.errors.push(args);
    },
  };

  const storageManager = {
    getStorage(storageId) {
      if (storageId === 'storage-ok') {
        return {
          async getStreamResponse() {
            return { stream: Readable.from([Buffer.from('ok')]) };
          },
        };
      }
      if (storageId === 'storage-fail') {
        return {
          async getStreamResponse() {
            return { stream: Readable.from([Buffer.from('fail')]) };
          },
        };
      }
      return null;
    },
  };

  const stats = await rebuildMetadataTask({
    force: false,
    db,
    storageManager,
    logger,
    wait: async () => {},
    sleepMs: 0,
    extractMetadata: async (buffer) => {
      if (buffer.toString('utf8') === 'fail') {
        throw new Error('metadata failed');
      }
      return {
        width: 640,
        height: 480,
        exif: '{"camera":"demo"}',
      };
    },
  });

  assert.deepEqual(stats, {
    total: 3,
    updated: 1,
    skipped: 1,
    failed: 1,
  });
  assert.equal(getFileById(db, 'file-meta-ok').width, 640);
  assert.equal(getFileById(db, 'file-meta-missing').width, null);
});
