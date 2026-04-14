import assert from 'node:assert/strict';
import test from 'node:test';

import { insertFile } from '../../src/database/files-dao.js';
import { initSchema } from '../../src/database/schema.js';
import { QuotaProjectionService } from '../../src/storage/quota/quota-projection-service.js';
import { createEmptyDb } from '../helpers/database-test-helpers.mjs';

function createQuotaDb() {
  const db = createEmptyDb();
  initSchema(db);
  return db;
}

function buildFileRecord(overrides = {}) {
  return {
    id: overrides.id || 'file-1',
    file_name: overrides.file_name || 'demo.png',
    original_name: overrides.original_name || 'origin-demo.png',
    mime_type: overrides.mime_type || 'image/png',
    size: overrides.size ?? 123,
    storage_channel: overrides.storage_channel || 'local',
    storage_key: overrides.storage_key || `storage-key-${overrides.id || 'file-1'}`,
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
    width: overrides.width ?? 100,
    height: overrides.height ?? 200,
    exif: overrides.exif ?? null,
    status: overrides.status || 'active',
  };
}

function insertQuotaEvent(db, {
  operationId,
  fileId = null,
  storageId,
  eventType,
  bytesDelta,
  fileCountDelta,
  idempotencyKey,
  payload = null,
  appliedAt = null,
  createdAt = '2000-01-01T00:00:00.000Z',
}) {
  db.prepare(`
    INSERT INTO storage_quota_events (
      operation_id, file_id, storage_id, event_type,
      bytes_delta, file_count_delta, idempotency_key, payload,
      applied_at, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    operationId,
    fileId,
    storageId,
    eventType,
    bytesDelta,
    fileCountDelta,
    idempotencyKey,
    payload,
    appliedAt,
    createdAt,
  );
}

test('QuotaProjectionService 会应用待处理容量事件并同步写入缓存与历史快照', async (t) => {
  const db = createQuotaDb();
  t.after(() => db.close());

  insertQuotaEvent(db, {
    operationId: 'op-upload-1',
    fileId: 'file-1',
    storageId: 'storage-a',
    eventType: 'upload',
    bytesDelta: 123,
    fileCountDelta: 1,
    idempotencyKey: 'quota-key-upload-1',
  });

  const service = new QuotaProjectionService({ db });
  const result = await service.applyPendingQuotaEvents({ operationId: 'op-upload-1' });

  assert.deepEqual(result, {
    applied: 1,
    storageIds: ['storage-a'],
  });

  const cacheRow = db.prepare(`
    SELECT storage_id, used_bytes, file_count
    FROM storage_quota_cache
    WHERE storage_id = ?
  `).get('storage-a');
  const historyRows = db.prepare(`
    SELECT storage_id, used_bytes
    FROM storage_quota_history
    WHERE storage_id = ?
    ORDER BY id ASC
  `).all('storage-a');
  const appliedCount = db.prepare(`
    SELECT COUNT(*) AS count
    FROM storage_quota_events
    WHERE operation_id = ? AND applied_at IS NOT NULL
  `).get('op-upload-1').count;

  assert.deepEqual(cacheRow, {
    storage_id: 'storage-a',
    used_bytes: 123,
    file_count: 1,
  });
  assert.deepEqual(historyRows, [
    {
      storage_id: 'storage-a',
      used_bytes: 123,
    },
  ]);
  assert.equal(appliedCount, 1);
  assert.equal(service.getUsedBytes('storage-a'), 123);
  assert.deepEqual(service.getUsageStats(), {
    'storage-a': {
      uploadCount: 1,
      fileCount: 1,
    },
  });
});

test('QuotaProjectionService 在删除事件使文件数归零时会移除缓存行', async (t) => {
  const db = createQuotaDb();
  t.after(() => db.close());

  insertFile(db, buildFileRecord({
    id: 'file-delete-1',
    size: 50,
    storage_instance_id: 'storage-z',
  }));
  db.prepare(`
    INSERT INTO storage_quota_cache (storage_id, used_bytes, file_count, last_updated)
    VALUES (?, ?, ?, CURRENT_TIMESTAMP)
  `).run('storage-z', 50, 1);
  insertQuotaEvent(db, {
    operationId: 'op-delete-1',
    fileId: 'file-delete-1',
    storageId: 'storage-z',
    eventType: 'delete',
    bytesDelta: -50,
    fileCountDelta: -1,
    idempotencyKey: 'quota-key-delete-1',
  });

  const service = new QuotaProjectionService({ db });
  await service.loadQuotaFromCache();
  await service.initUsageStats();
  const result = await service.applyPendingQuotaEvents({ operationId: 'op-delete-1' });

  const cacheCount = db.prepare(`
    SELECT COUNT(*) AS count
    FROM storage_quota_cache
    WHERE storage_id = ?
  `).get('storage-z').count;
  const historyRows = db.prepare(`
    SELECT used_bytes
    FROM storage_quota_history
    WHERE storage_id = ?
    ORDER BY id ASC
  `).all('storage-z');

  assert.deepEqual(result, {
    applied: 1,
    storageIds: ['storage-z'],
  });
  assert.equal(cacheCount, 0);
  assert.deepEqual(historyRows, [{ used_bytes: 0 }]);
  assert.equal(service.getUsedBytes('storage-z'), 0);
  assert.deepEqual(service.getUsageStats(), {
    'storage-z': {
      uploadCount: 0,
      fileCount: 0,
    },
  });
});

test('QuotaProjectionService 可以分别从容量缓存和历史快照重建内存投影', async (t) => {
  const db = createQuotaDb();
  t.after(() => db.close());

  db.prepare(`
    INSERT INTO storage_quota_cache (storage_id, used_bytes, file_count, last_updated)
    VALUES (?, ?, ?, CURRENT_TIMESTAMP)
  `).run('storage-cache', 88, 2);
  db.prepare(`
    INSERT INTO storage_quota_history (storage_id, used_bytes, recorded_at)
    VALUES (?, ?, ?)
  `).run('storage-history', 10, '2000-01-01 00:00:00');
  db.prepare(`
    INSERT INTO storage_quota_history (storage_id, used_bytes, recorded_at)
    VALUES (?, ?, ?)
  `).run('storage-history', 30, '2000-01-02 00:00:00');

  const cacheService = new QuotaProjectionService({ db });
  await cacheService.loadQuotaFromCache();

  const historyService = new QuotaProjectionService({ db });
  await historyService.loadQuotaFromHistory();

  assert.deepEqual(cacheService.getAllQuotaStats(), {
    'storage-cache': 88,
  });
  assert.deepEqual(historyService.getAllQuotaStats(), {
    'storage-history': 30,
  });
});

test('QuotaProjectionService 可以按 files 真值重建容量缓存并通过一致性校验', async (t) => {
  const db = createQuotaDb();
  t.after(() => db.close());

  insertFile(db, buildFileRecord({
    id: 'file-rebuild-a',
    size: 100,
    storage_instance_id: 'storage-a',
    status: 'active',
  }));
  insertFile(db, buildFileRecord({
    id: 'file-rebuild-b',
    size: 30,
    storage_instance_id: 'storage-b',
    status: 'active',
  }));
  insertFile(db, buildFileRecord({
    id: 'file-rebuild-ignored',
    size: 99,
    storage_instance_id: 'storage-a',
    status: 'channel_deleted',
  }));

  db.prepare(`
    INSERT INTO storage_quota_cache (storage_id, used_bytes, file_count, last_updated)
    VALUES (?, ?, ?, CURRENT_TIMESTAMP)
  `).run('storage-stale', 999, 9);
  insertQuotaEvent(db, {
    operationId: 'op-pending-rebuild',
    fileId: 'file-rebuild-a',
    storageId: 'storage-a',
    eventType: 'upload',
    bytesDelta: 100,
    fileCountDelta: 1,
    idempotencyKey: 'quota-key-rebuild-1',
  });

  const service = new QuotaProjectionService({ db });
  await service.rebuildAllQuotaStats();

  const cacheRows = db.prepare(`
    SELECT storage_id, used_bytes, file_count
    FROM storage_quota_cache
    ORDER BY storage_id ASC
  `).all();
  const historyRows = db.prepare(`
    SELECT storage_id, used_bytes
    FROM storage_quota_history
    ORDER BY storage_id ASC, id ASC
  `).all();
  const appliedCount = db.prepare(`
    SELECT COUNT(*) AS count
    FROM storage_quota_events
    WHERE applied_at IS NOT NULL
  `).get().count;
  const consistency = await service.verifyQuotaConsistency();

  assert.deepEqual(cacheRows, [
    { storage_id: 'storage-a', used_bytes: 100, file_count: 1 },
    { storage_id: 'storage-b', used_bytes: 30, file_count: 1 },
  ]);
  assert.deepEqual(historyRows, [
    { storage_id: 'storage-a', used_bytes: 100 },
    { storage_id: 'storage-b', used_bytes: 30 },
  ]);
  assert.equal(appliedCount, 1);
  assert.deepEqual(consistency, {
    consistent: true,
    inconsistencies: [],
  });
  assert.deepEqual(service.getUsageStats(), {
    'storage-a': {
      uploadCount: 0,
      fileCount: 1,
    },
    'storage-b': {
      uploadCount: 0,
      fileCount: 1,
    },
  });
});

test('QuotaProjectionService 会报告 mismatch、cache_orphan 和 cache_missing 三类不一致', async (t) => {
  const db = createQuotaDb();
  t.after(() => db.close());

  insertFile(db, buildFileRecord({
    id: 'file-mismatch',
    size: 100,
    storage_instance_id: 'storage-a',
  }));
  insertFile(db, buildFileRecord({
    id: 'file-cache-missing',
    size: 20,
    storage_instance_id: 'storage-c',
  }));

  db.prepare(`
    INSERT INTO storage_quota_cache (storage_id, used_bytes, file_count, last_updated)
    VALUES (?, ?, ?, CURRENT_TIMESTAMP)
  `).run('storage-a', 50, 1);
  db.prepare(`
    INSERT INTO storage_quota_cache (storage_id, used_bytes, file_count, last_updated)
    VALUES (?, ?, ?, CURRENT_TIMESTAMP)
  `).run('storage-b', 10, 1);

  const service = new QuotaProjectionService({ db });
  const result = await service.verifyQuotaConsistency();

  assert.equal(result.consistent, false);
  assert.deepEqual(
    result.inconsistencies
      .map(({ storageId, issue }) => `${storageId}:${issue}`)
      .sort(),
    [
      'storage-a:mismatch',
      'storage-b:cache_orphan',
      'storage-c:cache_missing',
    ],
  );
});
