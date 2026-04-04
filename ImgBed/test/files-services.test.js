const assert = require('node:assert/strict');
const { Readable } = require('stream');
const { parseStorageConfig, deleteFileRecord, deleteFilesBatch } = require('../src/services/files/delete-file');
const { validateMigrationTarget, migrateFileRecord, migrateFilesBatch } = require('../src/services/files/migrate-file');

function createDeleteDbRecorder() {
  const deletedIds = [];
  const updatedRows = [];

  return {
    deletedIds,
    updatedRows,
    api: {
      deleteFrom(table) {
        assert.equal(table, 'files');
        return {
          where(column, operator, value) {
            assert.equal(column, 'id');
            assert.equal(operator, '=');
            return {
              async execute() {
                deletedIds.push(value);
              },
            };
          },
        };
      },
      updateTable(table) {
        assert.equal(table, 'files');
        return {
          set(payload) {
            return {
              where(column, operator, value) {
                assert.equal(column, 'id');
                assert.equal(operator, '=');
                return {
                  async execute() {
                    updatedRows.push({ id: value, payload });
                  },
                };
              },
            };
          },
        };
      },
    },
  };
}

function createStorageManager(overrides = {}) {
  const storages = new Map();
  const instances = new Map();

  if (overrides.storages) {
    for (const [id, storage] of Object.entries(overrides.storages)) {
      storages.set(id, storage);
    }
  }

  if (overrides.instances) {
    for (const [id, entry] of Object.entries(overrides.instances)) {
      instances.set(id, entry);
    }
  }

  return {
    instances,
    getStorage: overrides.getStorage || ((id) => storages.get(id) || null),
    updateQuotaCache: overrides.updateQuotaCache || (() => {}),
    recordDelete: overrides.recordDelete || (() => {}),
    isUploadAllowed: overrides.isUploadAllowed || (() => true),
  };
}

async function testParseStorageConfigHandlesInvalidJson() {
  assert.deepEqual(parseStorageConfig('{bad json'), {});
  assert.deepEqual(parseStorageConfig(JSON.stringify({ instance_id: 'local-1' })), { instance_id: 'local-1' });
}

async function testDeleteFileRecordDeletesStorageAndChunks() {
  const deletedKeys = [];
  const quotaChanges = [];
  const deleteStats = [];
  const chunkDeletes = [];
  const warnings = [];
  const db = createDeleteDbRecorder();
  const storageManager = createStorageManager({
    storages: {
      local: {
        async delete(key) {
          deletedKeys.push(key);
        },
      },
    },
    updateQuotaCache: (id, delta) => quotaChanges.push({ id, delta }),
    recordDelete: (id) => deleteStats.push(id),
  });
  const chunkManager = {
    async deleteChunks(fileId, getStorageFn) {
      chunkDeletes.push({ fileId, hasStorage: !!getStorageFn('local') });
    },
  };

  const result = await deleteFileRecord({
    id: 'file-1',
    size: 12,
    storage_key: 'remote-key',
    storage_config: JSON.stringify({ instance_id: 'local' }),
    is_chunked: 1,
  }, {
    db: db.api,
    storageManager,
    ChunkManager: chunkManager,
    logger: { warn: (...args) => warnings.push(args.join(' ')) },
  });

  assert.equal(result.id, 'file-1');
  assert.equal(result.instanceId, 'local');
  assert.deepEqual(deletedKeys, ['remote-key']);
  assert.deepEqual(quotaChanges, [{ id: 'local', delta: -12 }]);
  assert.deepEqual(deleteStats, ['local']);
  assert.deepEqual(chunkDeletes, [{ fileId: 'file-1', hasStorage: true }]);
  assert.deepEqual(db.deletedIds, ['file-1']);
  assert.equal(warnings.length, 0);
}

async function testDeleteFilesBatchCountsProcessedFiles() {
  const db = createDeleteDbRecorder();
  const deleted = [];
  const storageManager = createStorageManager({
    storages: {
      local: { async delete() {} },
    },
    recordDelete: (id) => deleted.push(id),
  });

  const count = await deleteFilesBatch([
    { id: 'a', size: 0, storage_key: 'a', storage_config: JSON.stringify({ instance_id: 'local' }), is_chunked: 0 },
    { id: 'b', size: 0, storage_key: 'b', storage_config: JSON.stringify({ instance_id: 'local' }), is_chunked: 0 },
  ], {
    db: db.api,
    storageManager,
    ChunkManager: { async deleteChunks() {} },
  });

  assert.equal(count, 2);
  assert.deepEqual(db.deletedIds, ['a', 'b']);
  assert.deepEqual(deleted, ['local', 'local']);
}

async function testValidateMigrationTargetRejectsUnsupportedChannel() {
  const storageManager = createStorageManager({
    instances: {
      discord: { type: 'discord', instance: {} },
    },
    isUploadAllowed: () => true,
  });

  assert.throws(
    () => validateMigrationTarget('discord', storageManager),
    /目标渠道类型 discord 不支持作为迁移目标/
  );
}

async function testMigrateFileRecordMigratesAndUpdatesQuota() {
  const quotaChanges = [];
  const db = createDeleteDbRecorder();
  const sourceStorage = {
    async getStream() {
      return Readable.from([Buffer.from('abc')]);
    },
  };
  const targetStorage = {
    async put(buffer, payload) {
      assert.equal(buffer.toString(), 'abc');
      assert.equal(payload.id, 'file-1');
      return { id: 'new-key' };
    },
  };
  const storageManager = createStorageManager({
    instances: {
      source: { type: 'local', instance: sourceStorage },
      target: { type: 's3', instance: targetStorage },
    },
    updateQuotaCache: (id, delta) => quotaChanges.push({ id, delta }),
  });

  const result = await migrateFileRecord({
    id: 'file-1',
    size: 8,
    storage_key: 'old-key',
    storage_config: JSON.stringify({ instance_id: 'source' }),
    file_name: 'file-1.png',
    original_name: 'origin.png',
    mime_type: 'image/png',
  }, {
    targetChannel: 'target',
    targetEntry: { type: 's3', instance: targetStorage },
    db: db.api,
    storageManager,
  });

  assert.deepEqual(result, { status: 'success' });
  assert.deepEqual(quotaChanges, [
    { id: 'source', delta: -8 },
    { id: 'target', delta: 8 },
  ]);
  assert.equal(db.updatedRows.length, 1);
  assert.equal(db.updatedRows[0].id, 'file-1');
  assert.equal(db.updatedRows[0].payload.storage_channel, 's3');
  assert.equal(db.updatedRows[0].payload.storage_key, 'new-key');
}

async function testMigrateFilesBatchCollectsSuccessFailureAndSkipped() {
  const errors = [];
  const sourceStorage = {
    async getStream(key) {
      if (key === 'broken') {
        throw new Error('读取失败');
      }
      return Readable.from([Buffer.from('ok')]);
    },
  };
  const targetStorage = {
    async put(buffer) {
      return { id: `copied-${buffer.length}` };
    },
  };
  const db = createDeleteDbRecorder();
  const storageManager = createStorageManager({
    instances: {
      source: { type: 'local', instance: sourceStorage },
      target: { type: 's3', instance: targetStorage },
    },
    isUploadAllowed: (id) => id === 'target',
    updateQuotaCache: () => {},
  });

  const results = await migrateFilesBatch([
    {
      id: 'same',
      size: 1,
      storage_key: 'same',
      storage_config: JSON.stringify({ instance_id: 'target' }),
      file_name: 'same.png',
      original_name: 'same.png',
      mime_type: 'image/png',
    },
    {
      id: 'missing',
      size: 1,
      storage_key: 'missing',
      storage_config: JSON.stringify({ instance_id: 'ghost' }),
      file_name: 'missing.png',
      original_name: 'missing.png',
      mime_type: 'image/png',
    },
    {
      id: 'broken',
      size: 1,
      storage_key: 'broken',
      storage_config: JSON.stringify({ instance_id: 'source' }),
      file_name: 'broken.png',
      original_name: 'broken.png',
      mime_type: 'image/png',
    },
    {
      id: 'ok',
      size: 2,
      storage_key: 'ok',
      storage_config: JSON.stringify({ instance_id: 'source' }),
      file_name: 'ok.png',
      original_name: 'ok.png',
      mime_type: 'image/png',
    },
  ], {
    targetChannel: 'target',
    db: db.api,
    storageManager,
    logger: { error: (...args) => errors.push(args.join(' ')) },
  });

  assert.equal(results.total, 4);
  assert.equal(results.success, 1);
  assert.equal(results.failed, 2);
  assert.equal(results.skipped, 1);
  assert.equal(results.errors.length, 2);
  assert.equal(results.errors[0].id, 'missing');
  assert.equal(results.errors[1].id, 'broken');
  assert.equal(errors.length, 1);
}

async function main() {
  await testParseStorageConfigHandlesInvalidJson();
  await testDeleteFileRecordDeletesStorageAndChunks();
  await testDeleteFilesBatchCountsProcessedFiles();
  await testValidateMigrationTargetRejectsUnsupportedChannel();
  await testMigrateFileRecordMigratesAndUpdatesQuota();
  await testMigrateFilesBatchCollectsSuccessFailureAndSkipped();
  console.log('files service tests passed');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
