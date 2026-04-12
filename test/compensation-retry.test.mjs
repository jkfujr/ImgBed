import { strict as assert } from 'node:assert';

import { StorageOperationRecovery } from '../ImgBed/src/storage/recovery/storage-operation-recovery.js';
import { incrementOperationRetryCount } from '../ImgBed/src/services/system/storage-operations.js';

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

async function run() {
  console.log('\n== recovery / compensation retry tests ==');
  await testExecuteRecoveryIncrementsCountOnFailure();
  await testExecuteRecoveryMarksFailedWhenMaxRetriesReached();
  await testExecuteRecoveryDoesNotIncrementOnSuccess();
  await testIncrementOperationRetryCountCallsDb();
  console.log('\ncompensation-retry tests passed\n');
}

run().catch((err) => {
  console.error('\n测试失败:', err);
  process.exit(1);
});
