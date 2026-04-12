import { strict as assert } from 'node:assert';

import { StorageMaintenanceScheduler } from '../ImgBed/src/storage/runtime/storage-maintenance-scheduler.js';

function createScheduler({
  pendingCount = 1,
  recoverPendingOperations = async () => ({ recovered: 0, total: 0, skipped: false }),
  verifyQuotaConsistency = async () => ({ consistent: true, inconsistencies: [] }),
  rebuildQuotaStats = async () => {},
  getUploadConfig = () => ({ fullCheckIntervalHours: 6 }),
} = {}) {
  const db = {
    prepare(sql) {
      if (sql.includes('SELECT COUNT(*) AS count FROM storage_operations')) {
        return { get() { return { count: pendingCount }; } };
      }
      throw new Error(`Unhandled SQL: ${sql}`);
    },
  };

  return new StorageMaintenanceScheduler({
    db,
    logger: { info() {}, warn() {}, error() {} },
    getUploadConfig,
    verifyQuotaConsistency,
    rebuildQuotaStats,
    recoverPendingOperations,
  });
}

async function testCompensationBackoffResetsOnSuccess() {
  const scheduler = createScheduler({
    recoverPendingOperations: async () => ({ recovered: 2, total: 2, skipped: false }),
  });
  scheduler.compensationBackoffMs = 20 * 60 * 1000;

  scheduler.startCompensationRetryTimer();
  const timer = scheduler.compensationRetryTimer;
  try {
    await timer._onTimeout();
    assert.equal(scheduler.compensationBackoffMs, 5 * 60 * 1000);
  } finally {
    scheduler.stopCompensationRetryTimer();
  }

  console.log('  [OK] storage-maintenance-scheduler: compensation backoff resets after recovery success');
}

async function testCompensationBackoffDoublesAndStartIsIdempotent() {
  const scheduler = createScheduler({
    recoverPendingOperations: async () => ({ recovered: 0, total: 1, skipped: false }),
  });
  scheduler.compensationBackoffMs = 5 * 60 * 1000;

  scheduler.startCompensationRetryTimer();
  const timer = scheduler.compensationRetryTimer;
  await timer._onTimeout();
  assert.equal(scheduler.compensationBackoffMs, 10 * 60 * 1000);

  const sameTimer = scheduler.compensationRetryTimer;
  scheduler.startCompensationRetryTimer();
  assert.equal(scheduler.compensationRetryTimer, sameTimer);

  scheduler.stopCompensationRetryTimer();
  assert.equal(scheduler.compensationRetryTimer, null);
  console.log('  [OK] storage-maintenance-scheduler: compensation timer doubles backoff and start/stop are stable');
}

async function testFullRebuildTimerTriggersRebuildOnInconsistency() {
  let rebuildCount = 0;
  const scheduler = createScheduler({
    verifyQuotaConsistency: async () => ({ consistent: false, inconsistencies: [{ storageId: 'a' }] }),
    rebuildQuotaStats: async () => { rebuildCount++; },
  });

  scheduler.startFullRebuildTimer();
  const timer = scheduler.fullRebuildTimer;
  try {
    await timer._onTimeout();
    assert.equal(rebuildCount, 1);
  } finally {
    scheduler.stopFullRebuildTimer();
  }

  console.log('  [OK] storage-maintenance-scheduler: full rebuild timer triggers rebuild when consistency fails');
}

async function testStartStopAndRefreshLifecycle() {
  let rebuildCount = 0;
  const scheduler = createScheduler({
    rebuildQuotaStats: async () => { rebuildCount++; },
  });

  await scheduler.start();
  const fullTimer = scheduler.fullRebuildTimer;
  const compTimer = scheduler.compensationRetryTimer;
  assert.ok(fullTimer);
  assert.ok(compTimer);
  assert.equal(scheduler.started, true);

  await scheduler.start();
  assert.equal(scheduler.fullRebuildTimer, fullTimer);
  assert.equal(scheduler.compensationRetryTimer, compTimer);

  await scheduler.refresh();
  assert.equal(rebuildCount, 1);
  assert.notEqual(scheduler.fullRebuildTimer, fullTimer);

  scheduler.stop();
  assert.equal(scheduler.started, false);
  assert.equal(scheduler.fullRebuildTimer, null);
  assert.equal(scheduler.compensationRetryTimer, null);
  console.log('  [OK] storage-maintenance-scheduler: start/refresh/stop lifecycle is correct');
}

async function run() {
  console.log('running storage-maintenance-scheduler tests...');
  await testCompensationBackoffResetsOnSuccess();
  await testCompensationBackoffDoublesAndStartIsIdempotent();
  await testFullRebuildTimerTriggersRebuildOnInconsistency();
  await testStartStopAndRefreshLifecycle();
  console.log('storage-maintenance-scheduler tests passed');
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
