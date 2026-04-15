import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import test from 'node:test';

import { getFileById } from '../../src/database/files-dao.js';
import {
  createTestDb,
  getQuotaEvents,
  getStorageOperation,
  insertFileRecord,
} from '../helpers/storage-test-helpers.mjs';
import {
  createTempAppRoot,
  resolveProjectModuleUrl,
} from '../helpers/runtime-test-helpers.mjs';

const appRoot = createTempAppRoot('imgbed-04-file-migration-service-');
process.env.IMGBED_APP_ROOT = appRoot;

const configModule = await import(resolveProjectModuleUrl('src', 'config', 'index.js'));
configModule.loadStartupConfig();

const { createFileMigrationService } = await import(resolveProjectModuleUrl('src', 'services', 'files', 'migrate-file.js'));

function createMigrationHarness({
  db = createTestDb(),
  sourceBuffer = Buffer.from('demo'),
  targetLimits = {
    enableMaxLimit: false,
    maxLimitMB: 20,
    enableSizeLimit: false,
    sizeLimitMB: 20,
    enableChunking: false,
    chunkSizeMB: 5,
    maxChunks: 10,
  },
  analyzeResult = { needsChunking: false },
  sourceStorageOverrides = {},
  targetStorageOverrides = {},
  storageManagerOverrides = {},
  removeStoredArtifactsFn = null,
  updateFileMigrationFieldsFn = null,
} = {}) {
  const calls = {
    sourceReads: [],
    sourceDeletes: [],
    sourceChunkDeletes: [],
    targetPuts: [],
    uploadChunked: [],
    uploadS3Multipart: [],
    chunkReads: [],
    applyPendingQuotaEvents: [],
    removeStoredArtifacts: [],
  };

  const sourceStorage = {
    async getStreamResponse(storageKey) {
      calls.sourceReads.push(storageKey);
      return {
        stream: Readable.from([sourceBuffer]),
      };
    },
    async delete(storageKey, deleteToken) {
      calls.sourceDeletes.push({ storageKey, deleteToken });
      return true;
    },
    async deleteChunk(storageKey, deleteToken) {
      calls.sourceChunkDeletes.push({ storageKey, deleteToken });
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
    ...sourceStorageOverrides,
  };

  const targetStorage = {
    async put(stream, meta) {
      const chunks = [];
      for await (const chunk of stream) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      }
      const body = Buffer.concat(chunks);
      calls.targetPuts.push({
        meta,
        body: body.toString('utf8'),
      });
      return {
        storageKey: 'target-key',
        size: body.length,
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
    ...targetStorageOverrides,
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

  function buildChunkRecords(fileId) {
    return [
      {
        file_id: fileId,
        chunk_index: 0,
        storage_type: 'mock',
        storage_id: 'source-1',
        storage_key: 'source-chunk-0',
        storage_meta: null,
        size: 2,
      },
      {
        file_id: fileId,
        chunk_index: 1,
        storage_type: 'mock',
        storage_id: 'source-1',
        storage_key: 'source-chunk-1',
        storage_meta: null,
        size: 2,
      },
    ];
  }

  function persistChunkRecords(records, targetDb) {
    for (const record of records) {
      targetDb.prepare(`
        INSERT INTO chunks (
          file_id, chunk_index, storage_type, storage_id, storage_key, storage_meta, size
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(
        record.file_id,
        record.chunk_index,
        record.storage_type,
        record.storage_id,
        record.storage_key,
        record.storage_meta,
        record.size,
      );
    }
  }

  function resolveStorageWritePlanFn({ fileSize, storageId, storageType }) {
    if (!analyzeResult.needsChunking) {
      return {
        mode: 'direct',
        storageId,
        storageType,
        fileSize,
        limits: targetLimits,
        chunkConfig: null,
      };
    }

    return {
      mode: analyzeResult.config?.mode === 'native' ? 'native' : 'chunked',
      storageId,
      storageType,
      fileSize,
      limits: targetLimits,
      chunkConfig: analyzeResult.config,
    };
  }

  async function executePlannedBufferWriteFn({
    plan,
    buffer,
    fileId,
    newFileName,
    originalName,
    mimeType,
    config,
  }) {
    if (plan.mode === 'chunked') {
      calls.uploadChunked.push({
        size: buffer.length,
        options: {
          fileId,
          fileName: newFileName,
          originalName,
          mimeType,
          storageId: plan.storageId,
        },
      });
      return {
        storageResult: {
          storageKey: fileId,
          size: buffer.length,
          deleteToken: null,
        },
        isChunked: 1,
        chunkCount: 2,
        chunkRecords: [
          {
            file_id: fileId,
            chunk_index: 0,
            storage_type: 'mock',
            storage_id: plan.storageId,
            storage_key: 'chunk-0',
            storage_meta: null,
            size: Math.ceil(buffer.length / 2),
          },
          {
            file_id: fileId,
            chunk_index: 1,
            storage_type: 'mock',
            storage_id: plan.storageId,
            storage_key: 'chunk-1',
            storage_meta: null,
            size: Math.floor(buffer.length / 2),
          },
        ],
      };
    }

    if (plan.mode === 'native') {
      calls.uploadS3Multipart.push({
        size: buffer.length,
        options: {
          fileId,
          fileName: newFileName,
          originalName,
          mimeType,
          storageId: plan.storageId,
          config,
        },
      });
      return {
        storageResult: {
          storageKey: 'native-key',
          size: buffer.length,
          deleteToken: { uploadId: 'u-1' },
        },
        isChunked: 0,
        chunkCount: 0,
        chunkRecords: [],
      };
    }

    throw new Error(`未预期的写入模式: ${plan.mode}`);
  }

  const storageManager = {
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
      return targetLimits;
    },
    async applyPendingQuotaEvents(options) {
      calls.applyPendingQuotaEvents.push(options);
      return {
        applied: 2,
        storageIds: ['source-1', 'target-1'],
      };
    },
    ...storageManagerOverrides,
  };

  const service = createFileMigrationService({
    db,
    storageManager,
    applyPendingQuotaEvents: storageManager.applyPendingQuotaEvents,
    resolveStorageWritePlanFn,
    executePlannedBufferWriteFn,
    listChunkRecordsByFileIdFn: async (fileId) => {
      calls.chunkReads.push(fileId);
      return buildChunkRecords(fileId);
    },
    createChunkedReadStreamFn: () => Readable.from([sourceBuffer]),
    insertChunkRecordsFn: persistChunkRecords,
    deleteChunkRecordsByFileIdFn: (fileId, targetDb) => {
      targetDb.prepare('DELETE FROM chunks WHERE file_id = ?').run(fileId);
    },
    ...(removeStoredArtifactsFn ? {
      removeStoredArtifactsFn: async (payload) => {
        calls.removeStoredArtifacts.push(payload);
        return removeStoredArtifactsFn(payload);
      },
    } : {}),
    ...(updateFileMigrationFieldsFn ? { updateFileMigrationFieldsFn } : {}),
  });

  return {
    calls,
    db,
    service,
    storageManager,
  };
}

test('createFileMigrationService 在同源同目标时返回 skipped 且不创建存储操作记录', async (t) => {
  const harness = createMigrationHarness();
  t.after(() => harness.db.close());

  insertFileRecord(harness.db, {
    id: 'file-skip-1',
    storageInstanceId: 'source-1',
    storageKey: 'source-key',
  });

  const result = await harness.service.migrateFileRecord(getFileById(harness.db, 'file-skip-1'), {
    targetChannel: 'source-1',
    targetEntry: harness.storageManager.getStorageMeta('source-1'),
  });

  assert.deepEqual(result, { status: 'skipped' });
  assert.equal(harness.db.prepare('SELECT COUNT(*) AS count FROM storage_operations').get().count, 0);
});

test('createFileMigrationService 在源渠道缺失时返回 failed', async (t) => {
  const harness = createMigrationHarness();
  t.after(() => harness.db.close());

  insertFileRecord(harness.db, {
    id: 'file-missing-source',
    storageInstanceId: 'missing-source',
    storageKey: 'source-key',
  });

  const result = await harness.service.migrateFileRecord(getFileById(harness.db, 'file-missing-source'), {
    targetChannel: 'target-1',
  });

  assert.deepEqual(result, {
    status: 'failed',
    reason: '源渠道不存在',
  });
});

test('createFileMigrationService 在直流迁移成功路径下会更新文件、写入配额并清理源端对象', async (t) => {
  const harness = createMigrationHarness({
    sourceBuffer: Buffer.from('demo'),
  });
  t.after(() => harness.db.close());

  insertFileRecord(harness.db, {
    id: 'file-direct-1',
    fileName: 'direct-1.png',
    originalName: 'direct-1.png',
    size: 4,
    storageChannel: 'local',
    storageKey: 'source-key',
    storageInstanceId: 'source-1',
    deleteToken: { messageId: '1' },
  });

  const result = await harness.service.migrateFileRecord(getFileById(harness.db, 'file-direct-1'), {
    targetChannel: 'target-1',
  });

  assert.deepEqual(result, { status: 'success' });

  const migrated = getFileById(harness.db, 'file-direct-1');
  assert.equal(migrated.storage_channel, 's3');
  assert.equal(migrated.storage_key, 'target-key');
  assert.equal(migrated.storage_instance_id, 'target-1');
  assert.equal(migrated.is_chunked, 0);
  assert.deepEqual(harness.calls.targetPuts, [{
    meta: {
      id: 'file-direct-1',
      fileName: 'direct-1.png',
      originalName: 'direct-1.png',
      mimeType: 'image/png',
      contentLength: 4,
    },
    body: 'demo',
  }]);
  assert.deepEqual(harness.calls.sourceDeletes, [{
    storageKey: 'source-key',
    deleteToken: { messageId: '1' },
  }]);

  const operationId = harness.db.prepare('SELECT id FROM storage_operations LIMIT 1').get().id;
  const operation = getStorageOperation(harness.db, operationId);
  const quotaEvents = getQuotaEvents(harness.db, operationId);

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

test('createFileMigrationService 在 generic chunking 路径下会复用共享写入规划并写入 chunks', async (t) => {
  const harness = createMigrationHarness({
    sourceBuffer: Buffer.from('abcdef'),
    targetLimits: {
      enableMaxLimit: false,
      maxLimitMB: 20,
      enableSizeLimit: true,
      sizeLimitMB: 1,
      enableChunking: true,
      chunkSizeMB: 1,
      maxChunks: 10,
    },
    analyzeResult: {
      needsChunking: true,
      config: {
        mode: 'generic',
      },
    },
  });
  t.after(() => harness.db.close());

  insertFileRecord(harness.db, {
    id: 'file-generic-1',
    fileName: 'generic-1.png',
    originalName: 'generic-1.png',
    size: 6,
    storageChannel: 'local',
    storageKey: 'source-key',
    storageInstanceId: 'source-1',
  });

  const result = await harness.service.migrateFileRecord(getFileById(harness.db, 'file-generic-1'), {
    targetChannel: 'target-1',
  });

  assert.deepEqual(result, { status: 'success' });
  assert.equal(harness.calls.targetPuts.length, 0);
  assert.deepEqual(harness.calls.uploadChunked, [{
    size: 6,
    options: {
      fileId: 'file-generic-1',
      fileName: 'generic-1.png',
      originalName: 'generic-1.png',
      mimeType: 'image/png',
      storageId: 'target-1',
    },
  }]);

  const migrated = getFileById(harness.db, 'file-generic-1');
  assert.equal(migrated.storage_key, 'file-generic-1');
  assert.equal(migrated.is_chunked, 1);
  assert.equal(migrated.chunk_count, 2);
  assert.equal(harness.db.prepare('SELECT COUNT(*) AS count FROM chunks WHERE file_id = ?').get('file-generic-1').count, 2);
});

test('createFileMigrationService 在 native multipart 路径下会复用共享写入规划', async (t) => {
  const harness = createMigrationHarness({
    sourceBuffer: Buffer.from('native'),
    targetLimits: {
      enableMaxLimit: false,
      maxLimitMB: 20,
      enableSizeLimit: true,
      sizeLimitMB: 1,
      enableChunking: true,
      chunkSizeMB: 1,
      maxChunks: 10,
    },
    analyzeResult: {
      needsChunking: true,
      config: {
        mode: 'native',
      },
    },
  });
  t.after(() => harness.db.close());

  insertFileRecord(harness.db, {
    id: 'file-native-1',
    fileName: 'native-1.png',
    originalName: 'native-1.png',
    size: 6,
    storageChannel: 'local',
    storageKey: 'source-key',
    storageInstanceId: 'source-1',
  });

  const result = await harness.service.migrateFileRecord(getFileById(harness.db, 'file-native-1'), {
    targetChannel: 'target-1',
  });

  assert.deepEqual(result, { status: 'success' });
  assert.equal(harness.calls.targetPuts.length, 0);
  assert.deepEqual(harness.calls.uploadS3Multipart, [{
    size: 6,
    options: {
      fileId: 'file-native-1',
      fileName: 'native-1.png',
      originalName: 'native-1.png',
      mimeType: 'image/png',
      storageId: 'target-1',
      config: undefined,
    },
  }]);

  const migrated = getFileById(harness.db, 'file-native-1');
  assert.equal(migrated.storage_key, 'native-key');
  assert.equal(migrated.is_chunked, 0);
  assert.equal(migrated.chunk_count, 0);
});

test('createFileMigrationService 会处理源文件本身为 chunked 的读取路径', async (t) => {
  const harness = createMigrationHarness({
    sourceBuffer: Buffer.from('part'),
  });
  t.after(() => harness.db.close());

  insertFileRecord(harness.db, {
    id: 'file-source-chunked-1',
    fileName: 'source-chunked-1.png',
    originalName: 'source-chunked-1.png',
    size: 4,
    storageChannel: 'local',
    storageKey: 'source-key',
    storageInstanceId: 'source-1',
    isChunked: 1,
    chunkCount: 2,
  });

  const result = await harness.service.migrateFileRecord(getFileById(harness.db, 'file-source-chunked-1'), {
    targetChannel: 'target-1',
  });

  assert.deepEqual(result, { status: 'success' });
  assert.deepEqual(harness.calls.chunkReads, ['file-source-chunked-1']);
  assert.equal(harness.calls.sourceReads.length, 0);
  assert.deepEqual(harness.calls.sourceChunkDeletes, [
    { storageKey: 'source-chunk-0', deleteToken: null },
    { storageKey: 'source-chunk-1', deleteToken: null },
  ]);
  assert.deepEqual(harness.calls.targetPuts, [{
    meta: {
      id: 'file-source-chunked-1',
      fileName: 'source-chunked-1.png',
      originalName: 'source-chunked-1.png',
      mimeType: 'image/png',
      contentLength: 4,
    },
    body: 'part',
  }]);
});

test('createFileMigrationService 在目标写入失败时会保留 pending 状态并原样抛错', async (t) => {
  const harness = createMigrationHarness({
    targetStorageOverrides: {
      async put() {
        throw new Error('target put failed');
      },
    },
  });
  t.after(() => harness.db.close());

  insertFileRecord(harness.db, {
    id: 'file-write-fail-1',
    storageKey: 'source-key',
    storageInstanceId: 'source-1',
  });

  await assert.rejects(() => harness.service.migrateFileRecord(getFileById(harness.db, 'file-write-fail-1'), {
    targetChannel: 'target-1',
  }), /target put failed/);

  const operationId = harness.db.prepare('SELECT id FROM storage_operations LIMIT 1').get().id;
  const operation = getStorageOperation(harness.db, operationId);
  assert.equal(operation.status, 'pending');
});

test('createFileMigrationService 在 commit 失败时会补偿目标端对象并留下 compensated 状态', async (t) => {
  const harness = createMigrationHarness({
    updateFileMigrationFieldsFn() {
      throw new Error('update failed');
    },
    removeStoredArtifactsFn: async () => true,
  });
  t.after(() => harness.db.close());

  insertFileRecord(harness.db, {
    id: 'file-commit-fail-1',
    fileName: 'commit-fail-1.png',
    originalName: 'commit-fail-1.png',
    size: 4,
    storageChannel: 'local',
    storageKey: 'source-key',
    storageInstanceId: 'source-1',
  });

  await assert.rejects(() => harness.service.migrateFileRecord(getFileById(harness.db, 'file-commit-fail-1'), {
    targetChannel: 'target-1',
  }), /update failed/);

  const operationId = harness.db.prepare('SELECT id FROM storage_operations LIMIT 1').get().id;
  const operation = getStorageOperation(harness.db, operationId);

  assert.equal(operation.status, 'compensated');
  assert.equal(harness.calls.removeStoredArtifacts.length, 1);
  assert.equal(typeof harness.calls.removeStoredArtifacts[0].getStorage, 'function');
  assert.equal(harness.calls.removeStoredArtifacts[0].storageId, 'target-1');
  assert.equal(harness.calls.removeStoredArtifacts[0].storageKey, 'target-key');
  assert.deepEqual(harness.calls.removeStoredArtifacts[0].deleteToken, { messageId: '9' });
  assert.equal(harness.calls.removeStoredArtifacts[0].isChunked, false);
  assert.deepEqual(harness.calls.removeStoredArtifacts[0].chunkRecords, []);
});

test('createFileMigrationService 在 afterCommit 源端清理失败时保留 committed 状态', async (t) => {
  const harness = createMigrationHarness({
    removeStoredArtifactsFn: async (payload) => {
      if (payload.storageId === 'source-1') {
        throw new Error('source cleanup failed');
      }
      return true;
    },
  });
  t.after(() => harness.db.close());

  insertFileRecord(harness.db, {
    id: 'file-after-commit-fail-1',
    fileName: 'after-commit-fail-1.png',
    originalName: 'after-commit-fail-1.png',
    size: 4,
    storageChannel: 'local',
    storageKey: 'source-key',
    storageInstanceId: 'source-1',
    deleteToken: { messageId: '1' },
  });

  await assert.rejects(() => harness.service.migrateFileRecord(getFileById(harness.db, 'file-after-commit-fail-1'), {
    targetChannel: 'target-1',
  }), /source cleanup failed/);

  const operationId = harness.db.prepare('SELECT id FROM storage_operations LIMIT 1').get().id;
  const operation = getStorageOperation(harness.db, operationId);
  assert.equal(operation.status, 'committed');
  assert.deepEqual(harness.calls.applyPendingQuotaEvents, [{
    operationId,
    adjustUsageStats: true,
  }]);
});
