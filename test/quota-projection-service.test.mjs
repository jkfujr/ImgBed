import { strict as assert } from 'node:assert';

import { QuotaProjectionService } from '../ImgBed/src/storage/quota/quota-projection-service.js';

function makeLogger() {
  return {
    info() {},
    warn() {},
    error() {},
  };
}

function makeDb(handlers) {
  return {
    prepare(sql) {
      for (const [pattern, factory] of handlers) {
        if (pattern.test(sql)) {
          return factory(sql);
        }
      }
      throw new Error(`Unhandled SQL: ${sql}`);
    },
    transaction(fn) {
      return (...args) => fn(...args);
    },
  };
}

async function testLoadQuotaFromCacheFallsBackToHistory() {
  const service = new QuotaProjectionService({
    db: makeDb([
      [/FROM storage_quota_cache/, () => ({
        all() {
          throw new Error('cache unavailable');
        },
      })],
      [/FROM storage_quota_history h/, () => ({
        all() {
          return [
            { storage_id: 's1', used_bytes: 10 },
            { storage_id: 's2', used_bytes: 25 },
          ];
        },
      })],
    ]),
    logger: makeLogger(),
  });

  await service.loadQuotaFromCache();

  assert.equal(service.getUsedBytes('s1'), 10);
  assert.equal(service.getUsedBytes('s2'), 25);
  console.log('  [OK] quota-projection-service: cache load falls back to history snapshot');
}

async function testApplyPendingQuotaEventsProjectsBytesAndUsageStats() {
  const appliedIds = [];
  const snapshots = [];

  const service = new QuotaProjectionService({
    db: makeDb([
      [/WHERE applied_at IS NULL ORDER BY id ASC/, () => ({
        all() {
          return [
            { id: 1, storage_id: 's1', bytes_delta: 5, file_count_delta: 1, event_type: 'upload' },
            { id: 2, storage_id: 's1', bytes_delta: -2, file_count_delta: -1, event_type: 'delete' },
            { id: 3, storage_id: 's2', bytes_delta: 9, file_count_delta: 1, event_type: 'upload' },
          ];
        },
      })],
      [/SET applied_at = CURRENT_TIMESTAMP WHERE id = \\?/, () => ({
        run(id) {
          appliedIds.push(id);
        },
      })],
      [/INSERT INTO storage_quota_history/, () => ({
        run(storageId, usedBytes) {
          snapshots.push({ storageId, usedBytes });
        },
      })],
    ]),
    logger: makeLogger(),
  });

  service.quotaProjection = new Map([['s1', 10]]);
  service.usageStats = new Map([['s1', { uploadCount: 3, fileCount: 4 }]]);

  const result = await service.applyPendingQuotaEvents();

  assert.deepEqual(result, { applied: 3, storageIds: ['s1', 's2'] });
  assert.equal(service.getUsedBytes('s1'), 13);
  assert.equal(service.getUsedBytes('s2'), 9);
  assert.deepEqual(service.getUsageStats(), {
    s1: { uploadCount: 4, fileCount: 4 },
    s2: { uploadCount: 1, fileCount: 1 },
  });
  assert.deepEqual(appliedIds, [1, 2, 3]);
  assert.deepEqual(snapshots, [
    { storageId: 's1', usedBytes: 13 },
    { storageId: 's2', usedBytes: 9 },
  ]);
  console.log('  [OK] quota-projection-service: pending quota events update bytes, usage stats, and snapshots');
}

async function testRebuildAllQuotaStatsReplacesProjectionState() {
  const historyRecords = [];
  const cacheRecords = [];
  let markedPendingEvents = 0;

  const service = new QuotaProjectionService({
    db: makeDb([
      [/FROM files\\s+WHERE storage_instance_id IS NOT NULL AND status = 'active'/, () => ({
        all() {
          return [
            { storage_instance_id: 'a', used_bytes: 11, file_count: 2 },
            { storage_instance_id: 'b', used_bytes: 7, file_count: 1 },
          ];
        },
      })],
      [/SET applied_at = CURRENT_TIMESTAMP WHERE applied_at IS NULL/, () => ({
        run() {
          markedPendingEvents++;
        },
      })],
      [/INSERT INTO storage_quota_history \\(storage_id, used_bytes\\) VALUES \\(@storage_id, @used_bytes\\)/, () => ({
        run(record) {
          historyRecords.push(record);
        },
      })],
      [/INSERT INTO storage_quota_cache \\(storage_id, used_bytes, file_count, last_updated\\)/, () => ({
        run(record) {
          cacheRecords.push(record);
        },
      })],
    ]),
    logger: makeLogger(),
  });

  service.quotaProjection = new Map([['old', 99]]);
  service.usageStats = new Map([['old', { uploadCount: 5, fileCount: 5 }]]);

  await service.rebuildAllQuotaStats();

  assert.equal(markedPendingEvents, 1);
  assert.deepEqual(service.getAllQuotaStats(), { a: 11, b: 7 });
  assert.deepEqual(service.getUsageStats(), {
    a: { uploadCount: 0, fileCount: 2 },
    b: { uploadCount: 0, fileCount: 1 },
  });
  assert.deepEqual(historyRecords, [
    { storage_id: 'a', used_bytes: 11 },
    { storage_id: 'b', used_bytes: 7 },
  ]);
  assert.deepEqual(cacheRecords, [
    { storage_id: 'a', used_bytes: 11, file_count: 2 },
    { storage_id: 'b', used_bytes: 7, file_count: 1 },
  ]);
  console.log('  [OK] quota-projection-service: rebuild fully replaces projection and usage state');
}

async function testVerifyQuotaConsistencyReportsAllMismatchTypes() {
  const service = new QuotaProjectionService({
    db: makeDb([
      [/FROM files\\s+WHERE storage_instance_id IS NOT NULL AND status = 'active'/, () => ({
        all() {
          return [
            { storage_instance_id: 'match', used_bytes: 10, file_count: 1 },
            { storage_instance_id: 'missing', used_bytes: 4, file_count: 1 },
          ];
        },
      })],
      [/FROM storage_quota_cache/, () => ({
        all() {
          return [
            { storage_id: 'match', used_bytes: 9, file_count: 1 },
            { storage_id: 'orphan', used_bytes: 3, file_count: 2 },
          ];
        },
      })],
    ]),
    logger: makeLogger(),
  });

  const result = await service.verifyQuotaConsistency();

  assert.equal(result.consistent, false);
  assert.deepEqual(
    result.inconsistencies.map((item) => ({ storageId: item.storageId, issue: item.issue })),
    [
      { storageId: 'match', issue: 'mismatch' },
      { storageId: 'orphan', issue: 'cache_orphan' },
      { storageId: 'missing', issue: 'cache_missing' },
    ],
  );
  console.log('  [OK] quota-projection-service: consistency check reports mismatch, orphan, and missing cases');
}

async function main() {
  console.log('running quota-projection-service tests...');
  await testLoadQuotaFromCacheFallsBackToHistory();
  await testApplyPendingQuotaEventsProjectsBytesAndUsageStats();
  await testRebuildAllQuotaStatsReplacesProjectionState();
  await testVerifyQuotaConsistencyReportsAllMismatchTypes();
  console.log('quota-projection-service tests passed');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
