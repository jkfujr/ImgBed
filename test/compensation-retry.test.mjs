import { strict as assert } from 'node:assert';
import fs from 'node:fs';

import { getSystemConfigPath } from '../ImgBed/src/services/system/config-io.js';
import { StorageOperationRecovery } from '../ImgBed/src/storage/recovery/storage-operation-recovery.js';
import { incrementOperationRetryCount } from '../ImgBed/src/services/system/storage-operations.js';

function createSafeConfig() {
  return {
    server: { port: 13000, host: '0.0.0.0' },
    database: { path: './data/database.sqlite' },
    jwt: { secret: 'dev-secret-for-local-tests-only', expiresIn: '7d' },
    admin: { username: 'admin', password: 'admin' },
    storage: {
      default: 'local-1',
      allowedUploadChannels: ['local-1'],
      failoverEnabled: true,
      storages: [
        {
          id: 'local-1',
          type: 'local',
          name: 'Local Storage',
          enabled: true,
          allowUpload: true,
          config: { basePath: './data/storage' },
        },
      ],
    },
    security: { corsOrigin: '*', guestUploadEnabled: false, uploadPassword: '' },
    upload: { quotaCheckMode: 'auto', fullCheckIntervalHours: 6 },
    performance: {
      s3Multipart: { enabled: true, concurrency: 4, maxConcurrency: 8, minPartSize: 5242880 },
      responseCache: { enabled: true, ttlSeconds: 60, maxKeys: 1000 },
      quotaEventsArchive: { enabled: true, retentionDays: 30, batchSize: 500, maxBatchesPerRun: 10, scheduleHour: 3 },
    },
  };
}

function ensureValidConfigFile() {
  const configPath = getSystemConfigPath();
  try {
    JSON.parse(fs.readFileSync(configPath, 'utf8'));
  } catch {
    fs.writeFileSync(configPath, JSON.stringify(createSafeConfig(), null, 2), 'utf8');
  }
}

async function loadStorageManagerClass() {
  ensureValidConfigFile();
  const module = await import('../ImgBed/src/storage/manager.js');
  return module.StorageManager;
}

function makeTrackingDb(operationRow = null) {
  const calls = { prepares: [], runs: [] };
  const db = {
    _calls: calls,
    _operationRow: operationRow,
    _updatedRows: [],
    prepare(sql) {
      calls.prepares.push(sql);

      if (sql.includes('SELECT * FROM storage_operations WHERE id = ? LIMIT 1')) {
        return {
          get() {
            return db._operationRow;
          },
        };
      }

      if (sql.includes('UPDATE storage_operations SET retry_count = COALESCE(retry_count, 0) + 1')) {
        return {
          run(...args) {
            calls.runs.push({ sql, args });
          },
        };
      }

      if (sql.includes('UPDATE storage_operations SET')) {
        return {
          run(payload) {
            calls.runs.push({ sql, args: [payload] });
            db._updatedRows.push(payload);
          },
        };
      }

      return {
        run(...args) { calls.runs.push({ sql, args }); },
        get(...args) {
          calls.runs.push({ sql, args, type: 'get' });
          return operationRow;
        },
        all() { return []; },
      };
    },
    transaction(fn) {
      return (...args) => fn(...args);
    },
  };
  return db;
}

function createRecoveryService({ db, applyPendingQuotaEvents = async () => {}, storageManager } = {}) {
  return new StorageOperationRecovery({
    db: db ?? makeTrackingDb(),
    logger: { info() {}, warn() {}, error() {} },
    storageManager: storageManager ?? { getStorage() { return null; } },
    applyPendingQuotaEvents,
  });
}

async function testExecuteRecoveryIncrementsCountOnFailure() {
  const db = makeTrackingDb({ id: 'op-1', status: 'compensation_pending', retry_count: 0 });
  const recovery = createRecoveryService({ db });
  recovery.executeCompensation = async () => { throw new Error('network timeout'); };

  await recovery.executeRecovery({ id: 'op-1', status: 'compensation_pending', retry_count: 0 });

  const retryUpdate = db._calls.runs.find((run) =>
    run.sql.includes('retry_count') && run.args?.includes?.('op-1')
  );
  assert.ok(retryUpdate, 'failure should increment retry_count');
  assert.equal(db._updatedRows.length, 0, 'below max retries should not mark failed');
  console.log('  [OK] StorageOperationRecovery.executeRecovery increments retry_count on failure');
}

async function testExecuteRecoveryMarksFailedWhenMaxRetriesReached() {
  const db = makeTrackingDb({ id: 'op-2', status: 'compensation_pending', retry_count: 5 });
  const recovery = createRecoveryService({ db });
  let executed = 0;
  recovery.executeCompensation = async () => { executed++; };

  await recovery.executeRecovery({ id: 'op-2', status: 'compensation_pending', retry_count: 5 });

  assert.equal(executed, 0, 'max retry operations should not execute compensation');
  assert.equal(db._updatedRows.length, 1, 'max retry operations should be marked failed');
  assert.equal(db._updatedRows[0].status, 'failed');
  console.log('  [OK] StorageOperationRecovery.executeRecovery marks failed after max retries');
}

async function testExecuteRecoveryDoesNotIncrementOnSuccess() {
  const db = makeTrackingDb({ id: 'op-3', status: 'remote_done', retry_count: 2 });
  const recovery = createRecoveryService({ db });
  recovery.recoverRemoteDoneOperation = async () => {};

  await recovery.executeRecovery({ id: 'op-3', status: 'remote_done', retry_count: 2 });

  const retryUpdate = db._calls.runs.find((run) =>
    run.sql.includes('retry_count') && run.args?.includes?.('op-3')
  );
  assert.equal(retryUpdate, undefined, 'successful recovery should not increment retry_count');
  console.log('  [OK] StorageOperationRecovery.executeRecovery leaves retry_count unchanged on success');
}

async function testIncrementOperationRetryCountCallsDb() {
  const db = makeTrackingDb();
  incrementOperationRetryCount(db, 'op-x');

  const run = db._calls.runs.find((item) =>
    item.sql.includes('retry_count') && item.args[0] === 'op-x'
  );
  assert.ok(run, 'incrementOperationRetryCount should issue retry_count update');
  console.log('  [OK] incrementOperationRetryCount sends operationId to db');
}

async function testBackoffResetsOnRecoverySuccess() {
  const StorageManager = await loadStorageManagerClass();
  const db = {
    prepare(sql) {
      if (sql.includes('SELECT COUNT(*) AS count FROM storage_operations')) {
        return { get() { return { count: 1 }; } };
      }
      throw new Error(`Unhandled SQL: ${sql}`);
    },
  };

  const manager = new StorageManager({ db });
  manager.recoveryService.recoverPendingOperations = async () => ({ recovered: 2, total: 2, skipped: false });
  manager._compensationBackoffMs = 20 * 60 * 1000;

  manager._startCompensationRetryTimer();
  const timer = manager._compensationRetryTimer;
  try {
    await timer._onTimeout();
    assert.equal(manager._compensationBackoffMs, 5 * 60 * 1000);
  } finally {
    manager._stopCompensationRetryTimer();
  }
  console.log('  [OK] StorageManager compensation timer resets backoff after recovery success');
}

async function testBackoffDoublesAndTimerStopsCleanly() {
  const StorageManager = await loadStorageManagerClass();
  const db = {
    prepare(sql) {
      if (sql.includes('SELECT COUNT(*) AS count FROM storage_operations')) {
        return { get() { return { count: 1 }; } };
      }
      throw new Error(`Unhandled SQL: ${sql}`);
    },
  };

  const manager = new StorageManager({ db });
  manager.recoveryService.recoverPendingOperations = async () => ({ recovered: 0, total: 1, skipped: false });
  manager._compensationBackoffMs = 5 * 60 * 1000;

  manager._startCompensationRetryTimer();
  const timer = manager._compensationRetryTimer;
  await timer._onTimeout();
  assert.equal(manager._compensationBackoffMs, 10 * 60 * 1000);

  const sameTimer = manager._compensationRetryTimer;
  manager._startCompensationRetryTimer();
  assert.equal(manager._compensationRetryTimer, sameTimer, 'timer start should be idempotent');

  manager._stopCompensationRetryTimer();
  assert.equal(manager._compensationRetryTimer, null);
  console.log('  [OK] StorageManager compensation timer doubles backoff and stop is clean');
}

async function run() {
  console.log('\n== recovery / compensation retry tests ==');
  await testExecuteRecoveryIncrementsCountOnFailure();
  await testExecuteRecoveryMarksFailedWhenMaxRetriesReached();
  await testExecuteRecoveryDoesNotIncrementOnSuccess();
  await testIncrementOperationRetryCountCallsDb();
  await testBackoffResetsOnRecoverySuccess();
  await testBackoffDoublesAndTimerStopsCleanly();
  console.log('\ncompensation-retry tests passed\n');
}

run().catch((err) => {
  console.error('\n测试失败:', err);
  process.exit(1);
});
