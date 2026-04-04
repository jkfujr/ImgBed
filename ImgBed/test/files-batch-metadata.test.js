const assert = require('node:assert/strict');
const { Readable } = require('stream');
const { moveFilesBatch, validateBatchIds, executeFilesBatchAction } = require('../src/services/files/batch-action');
const { resolveFileStorageId, rebuildMetadataForFile, rebuildMetadataTask } = require('../src/services/files/rebuild-metadata');

function createDbRecorder(files = []) {
  const updatedRows = [];

  return {
    updatedRows,
    api: {
      updateTable(table) {
        assert.equal(table, 'files');
        return {
          set(payload) {
            return {
              where(column, operator, value) {
                return {
                  async execute() {
                    updatedRows.push({ column, operator, value, payload });
                  },
                };
              },
            };
          },
        };
      },
      selectFrom(table) {
        assert.equal(table, 'files');
        const state = { rows: files };
        return {
          selectAll() {
            return this;
          },
          where() {
            return this;
          },
          async execute() {
            return state.rows;
          },
        };
      },
    },
  };
}

function createStorageManager(storages = {}) {
  return {
    getStorage(id) {
      return storages[id] || null;
    },
  };
}

async function testValidateBatchIdsRejectsEmptyArray() {
  assert.throws(() => validateBatchIds([]), /未附带任何将要施加作用的主键/);
}

async function testMoveFilesBatchUpdatesDirectory() {
  const db = createDbRecorder();
  const result = await moveFilesBatch(['a', 'b'], '/archive', db.api);

  assert.equal(result.code, 0);
  assert.equal(result.message, '移库完成，已将 2 宗物品改签至 /archive');
  assert.equal(db.updatedRows.length, 1);
  assert.deepEqual(db.updatedRows[0].payload, { directory: '/archive' });
}

async function testExecuteFilesBatchActionSupportsMove() {
  const db = createDbRecorder();
  const result = await executeFilesBatchAction({
    action: 'move',
    ids: ['f1'],
    targetDirectory: '/new',
    targetChannel: null,
    db: db.api,
    storageManager: {},
    ChunkManager: {},
  });

  assert.equal(result.code, 0);
  assert.equal(result.message, '移库完成，已将 1 宗物品改签至 /new');
}

async function testResolveFileStorageIdPrefersInstanceId() {
  assert.equal(resolveFileStorageId({ storage_channel: 'local', storage_config: JSON.stringify({ instance_id: 'local-1' }) }), 'local-1');
  assert.equal(resolveFileStorageId({ storage_channel: 'local', storage_config: '{bad' }), 'local');
}

async function testRebuildMetadataForFileUpdatesMetadata() {
  const db = createDbRecorder();
  const waits = [];
  const storageManager = createStorageManager({
    local: {
      async getStream() {
        return Readable.from([Buffer.from('img')]);
      },
    },
  });

  const result = await rebuildMetadataForFile({
    id: 'file-1',
    storage_channel: 'local',
    storage_key: 'key-1',
    storage_config: null,
  }, {
    db: db.api,
    storageManager,
    wait: async (ms) => waits.push(ms),
    sleepMs: 5,
    extractMetadata: async () => ({ width: 100, height: 50, exif: '{"ok":true}' }),
  });

  assert.deepEqual(result, { status: 'updated' });
  assert.deepEqual(waits, [5]);
  assert.equal(db.updatedRows.length, 1);
  assert.deepEqual(db.updatedRows[0].payload, { width: 100, height: 50, exif: '{"ok":true}' });
}

async function testRebuildMetadataForFileSkipsMissingStorage() {
  const warnings = [];
  const db = createDbRecorder();
  const result = await rebuildMetadataForFile({
    id: 'file-2',
    storage_channel: 'ghost',
    storage_key: 'key-2',
    storage_config: null,
  }, {
    db: db.api,
    storageManager: createStorageManager(),
    logger: { warn: (...args) => warnings.push(args.join(' ')) },
    wait: async () => {},
    extractMetadata: async () => ({ width: 1, height: 1, exif: '{}' }),
  });

  assert.deepEqual(result, { status: 'skipped', reason: 'missing_storage' });
  assert.equal(warnings.length, 1);
}

async function testRebuildMetadataTaskAggregatesStats() {
  const logs = [];
  const errors = [];
  const files = [
    { id: 'a', mime_type: 'image/png', width: null, storage_channel: 'local', storage_key: 'a', storage_config: null },
    { id: 'b', mime_type: 'image/png', width: null, storage_channel: 'missing', storage_key: 'b', storage_config: null },
    { id: 'c', mime_type: 'image/png', width: null, storage_channel: 'local', storage_key: 'c', storage_config: null },
  ];
  const db = createDbRecorder(files);
  const storageManager = createStorageManager({
    local: {
      async getStream(key) {
        return Readable.from([Buffer.from(key)]);
      },
    },
  });

  const stats = await rebuildMetadataTask({
    force: false,
    db: db.api,
    storageManager,
    logger: {
      log: (...args) => logs.push(args.join(' ')),
      warn: () => {},
      error: (...args) => errors.push(args.join(' ')),
    },
    wait: async () => {},
    extractMetadata: async (buffer) => {
      if (buffer.toString() === 'c') {
        throw new Error('metadata fail');
      }
      return { width: 10, height: 20, exif: '{}' };
    },
  });

  assert.deepEqual(stats, { total: 3, updated: 1, skipped: 1, failed: 1 });
  assert.equal(db.updatedRows.length, 1);
  assert.equal(errors.length, 1);
  assert.ok(logs.some((line) => line.includes('开始增量重建元数据')));
}

async function main() {
  await testValidateBatchIdsRejectsEmptyArray();
  await testMoveFilesBatchUpdatesDirectory();
  await testExecuteFilesBatchActionSupportsMove();
  await testResolveFileStorageIdPrefersInstanceId();
  await testRebuildMetadataForFileUpdatesMetadata();
  await testRebuildMetadataForFileSkipsMissingStorage();
  await testRebuildMetadataTaskAggregatesStats();
  console.log('files batch and metadata tests passed');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
