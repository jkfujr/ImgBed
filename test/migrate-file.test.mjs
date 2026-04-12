import { strict as assert } from 'node:assert';
import { Readable } from 'node:stream';

import {
  validateMigrationTarget,
  migrateFileRecord,
  migrateFilesBatch,
} from '../ImgBed/src/services/files/migrate-file.js';

function makeDb() {
  const operations = new Map();
  return {
    prepare(sql) {
      if (sql.startsWith('INSERT INTO storage_operations')) {
        return {
          run(id, operationType, fileId, status, sourceStorageId, targetStorageId, remotePayload, compensationPayload, errorMessage) {
            operations.set(id, {
              id,
              operation_type: operationType,
              file_id: fileId,
              status,
              source_storage_id: sourceStorageId,
              target_storage_id: targetStorageId,
              remote_payload: remotePayload,
              compensation_payload: compensationPayload,
              error_message: errorMessage,
              retry_count: 0,
            });
          },
          all() { return []; },
          get() { return null; },
        };
      }

      if (sql === 'SELECT * FROM storage_operations WHERE id = ? LIMIT 1') {
        return {
          get(id) {
            return operations.get(id) || null;
          },
          run() {},
          all() { return []; },
        };
      }

      if (sql.includes('UPDATE storage_operations SET')) {
        return {
          run(next) {
            operations.set(next.id, { ...next });
          },
          all() { return []; },
          get() { return null; },
        };
      }

      if (sql === 'UPDATE storage_operations SET retry_count = COALESCE(retry_count, 0) + 1 WHERE id = ?') {
        return {
          run(id) {
            const current = operations.get(id);
            if (!current) return;
            operations.set(id, {
              ...current,
              retry_count: (current.retry_count ?? 0) + 1,
            });
          },
          all() { return []; },
          get() { return null; },
        };
      }

      return {
        run() {},
        all() { return []; },
        get() { return null; },
      };
    },
    transaction(fn) {
      return fn;
    },
  };
}

function makeStorage({ streamContent = 'file-content', putResult = null } = {}) {
  let lastPutFile = null;
  let lastPutOptions = null;

  return {
    async getStream() {
      return Readable.from([Buffer.from(streamContent)]);
    },
    async put(file, options) {
      lastPutFile = file;
      lastPutOptions = options;
      return putResult ?? { id: options.id || options.fileName };
    },
    async delete() {
      return true;
    },
    getChunkConfig() {
      return { enabled: false, chunkThreshold: Infinity, chunkSize: 0, maxChunks: 0, mode: 'generic' };
    },
    getLastPutFile() {
      return lastPutFile;
    },
    getLastPutOptions() {
      return lastPutOptions;
    },
  };
}

function makeStorageManager({
  instances = new Map(),
  isUploadAllowed = () => true,
  getEffectiveUploadLimits = () => ({ enableSizeLimit: false, enableChunking: false, chunkSizeMB: 5, maxChunks: 0 }),
  applyPendingQuotaEvents = async () => {},
} = {}) {
  return {
    instances,
    isUploadAllowed,
    getEffectiveUploadLimits,
    getStorage(id) {
      return instances.get(id)?.instance;
    },
    getStorageMeta(id) {
      return instances.get(id) || null;
    },
    applyPendingQuotaEvents,
  };
}

function makeFileRecord(overrides = {}) {
  return {
    id: 'file-001',
    file_name: 'img.png',
    original_name: 'img.png',
    mime_type: 'image/png',
    storage_channel: 's3',
    storage_config: JSON.stringify({ instance_id: 'src-channel' }),
    storage_instance_id: 'src-channel',
    storage_key: 'img.png',
    is_chunked: 0,
    size: 1024,
    ...overrides,
  };
}

function captureError(fn) {
  try {
    fn();
    return null;
  } catch (error) {
    return error;
  }
}

function testValidateMigrationTarget() {
  const emptyManager = makeStorageManager();
  assert.equal(captureError(() => validateMigrationTarget(null, emptyManager))?.status, 400);
  assert.equal(captureError(() => validateMigrationTarget('missing', emptyManager))?.status, 404);

  const blockedManager = makeStorageManager({
    instances: new Map([['target', { type: 's3', instance: {} }]]),
    isUploadAllowed: () => false,
  });
  assert.equal(captureError(() => validateMigrationTarget('target', blockedManager))?.status, 403);

  const wrongTypeManager = makeStorageManager({
    instances: new Map([['target', { type: 'discord', instance: {} }]]),
  });
  assert.equal(captureError(() => validateMigrationTarget('target', wrongTypeManager))?.status, 403);

  const okManager = makeStorageManager({
    instances: new Map([['target', { type: 's3', instance: {} }]]),
  });
  assert.equal(validateMigrationTarget('target', okManager).type, 's3');
  console.log('  [OK] validateMigrationTarget: 公开 facade 校验正常');
}

async function testMigrateFileRecordSkipsSameChannel() {
  const storage = makeStorage();
  const storageManager = makeStorageManager({
    instances: new Map([['same-ch', { type: 's3', instance: storage }]]),
  });

  const result = await migrateFileRecord(makeFileRecord({ storage_instance_id: 'same-ch' }), {
    targetChannel: 'same-ch',
    targetEntry: { type: 's3', instance: storage },
    db: makeDb(),
    storageManager,
  });

  assert.equal(result.status, 'skipped');
  console.log('  [OK] migrateFileRecord: 同渠道直接跳过');
}

async function testMigrateFileRecordFailsWhenSourceMissing() {
  const targetStorage = makeStorage();
  const storageManager = makeStorageManager({
    instances: new Map([['target-ch', { type: 's3', instance: targetStorage }]]),
  });

  const result = await migrateFileRecord(makeFileRecord({ storage_instance_id: 'missing-src' }), {
    targetChannel: 'target-ch',
    targetEntry: { type: 's3', instance: targetStorage },
    db: makeDb(),
    storageManager,
  });

  assert.equal(result.status, 'failed');
  console.log('  [OK] migrateFileRecord: 源渠道缺失返回 failed');
}

async function testMigrateFileRecordNonChunkedUsesStream() {
  const sourceStorage = makeStorage({ streamContent: 'stream-migrate-content' });
  const targetStorage = makeStorage({ putResult: { id: 'file-001' } });
  const storageManager = makeStorageManager({
    instances: new Map([
      ['src-channel', { type: 's3', instance: sourceStorage }],
      ['target-ch', { type: 's3', instance: targetStorage }],
    ]),
  });

  const result = await migrateFileRecord(makeFileRecord({
    storage_instance_id: 'src-channel',
    size: 'stream-migrate-content'.length,
  }), {
    targetChannel: 'target-ch',
    targetEntry: { type: 's3', instance: targetStorage },
    db: makeDb(),
    storageManager,
  });

  assert.equal(result.status, 'success');
  assert.ok(targetStorage.getLastPutFile() instanceof Readable);
  assert.equal(targetStorage.getLastPutOptions().contentLength, 'stream-migrate-content'.length);
  console.log('  [OK] migrateFileRecord: 非分块迁移保持流式写入');
}

async function testMigrateFilesBatchCountsResults() {
  const sourceStorage = makeStorage({ streamContent: 'batch-file' });
  const targetStorage = makeStorage({ putResult: { id: 'file-001' } });
  const storageManager = makeStorageManager({
    instances: new Map([
      ['src-channel', { type: 's3', instance: sourceStorage }],
      ['target-ch', { type: 's3', instance: targetStorage }],
    ]),
  });

  const files = [
    makeFileRecord({ id: 'f1', storage_instance_id: 'src-channel' }),
    makeFileRecord({ id: 'f2', storage_instance_id: 'target-ch' }),
    makeFileRecord({ id: 'f3', storage_instance_id: 'missing-source' }),
  ];

  const result = await migrateFilesBatch(files, {
    targetChannel: 'target-ch',
    db: makeDb(),
    storageManager,
  });

  assert.equal(result.total, 3);
  assert.equal(result.success, 1);
  assert.equal(result.skipped, 1);
  assert.equal(result.failed, 1);
  assert.equal(result.errors.length, 1);
  console.log('  [OK] migrateFilesBatch: success/skipped/failed 统计正确');
}

async function run() {
  console.log('\n== migrate-file 测试 ==');
  testValidateMigrationTarget();
  await testMigrateFileRecordSkipsSameChannel();
  await testMigrateFileRecordFailsWhenSourceMissing();
  await testMigrateFileRecordNonChunkedUsesStream();
  await testMigrateFilesBatchCountsResults();
  console.log('\n全部 migrate-file 测试通过\n');
}

run().catch((err) => {
  console.error('\n测试失败:', err);
  process.exit(1);
});
