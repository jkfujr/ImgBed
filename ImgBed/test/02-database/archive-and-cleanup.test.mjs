import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

import { cleanupCompletedOperations } from '../../src/services/archive/storage-operations-cleanup.js';
import { createTestDb } from '../helpers/storage-test-helpers.mjs';
import {
  cleanupPath,
  createTempAppRoot,
  resolveProjectPath,
} from '../helpers/runtime-test-helpers.mjs';

test('cleanupCompletedOperations 只清理超过保留期的 completed/compensated 记录', async (t) => {
  const db = createTestDb();
  t.after(() => db.close());

  db.prepare(`
    INSERT INTO storage_operations (
      id, operation_type, file_id, status,
      source_storage_id, target_storage_id,
      remote_payload, compensation_payload, error_message,
      retry_count, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    'op-old-completed',
    'upload',
    'file-1',
    'completed',
    null,
    'storage-1',
    null,
    null,
    null,
    0,
    '2000-01-01 00:00:00',
    '2000-01-01 00:00:00',
  );
  db.prepare(`
    INSERT INTO storage_operations (
      id, operation_type, file_id, status,
      source_storage_id, target_storage_id,
      remote_payload, compensation_payload, error_message,
      retry_count, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    'op-old-pending',
    'upload',
    'file-2',
    'pending',
    null,
    'storage-1',
    null,
    null,
    null,
    0,
    '2000-01-01 00:00:00',
    '2000-01-01 00:00:00',
  );
  db.prepare(`
    INSERT INTO storage_operations (
      id, operation_type, file_id, status,
      source_storage_id, target_storage_id,
      remote_payload, compensation_payload, error_message,
      retry_count, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    'op-new-compensated',
    'delete',
    'file-3',
    'compensated',
    'storage-1',
    null,
    null,
    null,
    null,
    0,
    '2099-01-01 00:00:00',
    '2099-01-01 00:00:00',
  );

  const result = await cleanupCompletedOperations(db, 90);
  const remainingIds = db.prepare('SELECT id FROM storage_operations ORDER BY id ASC').all().map((row) => row.id);

  assert.deepEqual(result, { deleted: 1 });
  assert.deepEqual(remainingIds, ['op-new-compensated', 'op-old-pending']);
});

test('QuotaEventsArchive 会归档已应用且超过保留期的事件，并保留 pending 事件', (t) => {
  const appRoot = createTempAppRoot('imgbed-archive-');
  t.after(() => cleanupPath(appRoot));

  const script = `
    const { loadStartupConfig } = await import('./src/config/index.js');
    loadStartupConfig();

    const { initSchema } = await import('./src/database/schema.js');
    const { sqlite } = await import('./src/database/index.js');
    const { initQuotaEventsArchive, getQuotaEventsArchive } = await import('./src/services/archive/quota-events-archive.js');

    initSchema(sqlite);

    sqlite.prepare(\`
      INSERT INTO storage_quota_events (
        operation_id, file_id, storage_id, event_type,
        bytes_delta, file_count_delta, idempotency_key, payload,
        applied_at, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    \`).run('op-1', 'file-1', 'storage-a', 'upload', 100, 1, 'key-1', null, '2000-01-01T00:00:00.000Z', '2000-01-01T00:00:00.000Z');
    sqlite.prepare(\`
      INSERT INTO storage_quota_events (
        operation_id, file_id, storage_id, event_type,
        bytes_delta, file_count_delta, idempotency_key, payload,
        applied_at, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    \`).run('op-2', 'file-2', 'storage-a', 'delete', -50, -1, 'key-2', null, '2000-01-02T00:00:00.000Z', '2000-01-02T00:00:00.000Z');
    sqlite.prepare(\`
      INSERT INTO storage_quota_events (
        operation_id, file_id, storage_id, event_type,
        bytes_delta, file_count_delta, idempotency_key, payload,
        applied_at, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    \`).run('op-3', 'file-3', 'storage-b', 'upload', 30, 1, 'key-3', null, null, '2000-01-03T00:00:00.000Z');

    initQuotaEventsArchive({
      enabled: true,
      retentionDays: 30,
      batchSize: 1,
      maxBatchesPerRun: 5,
    });

    const archive = getQuotaEventsArchive();
    const result = await archive.archive();
    const stats = archive.getStats();

    console.log('JSON_RESULT ' + JSON.stringify({ result, stats }));
  `;

  const execution = spawnSync(process.execPath, ['--input-type=module', '-e', script], {
    cwd: resolveProjectPath(),
    env: {
      ...process.env,
      IMGBED_APP_ROOT: appRoot,
      LOG_LEVEL: 'silent',
    },
    encoding: 'utf8',
  });

  assert.equal(execution.status, 0, execution.stderr || execution.stdout);

  const outputLines = execution.stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const jsonLine = outputLines.find((line) => line.startsWith('JSON_RESULT '));

  assert.ok(jsonLine, execution.stdout);

  const payload = JSON.parse(jsonLine.slice('JSON_RESULT '.length));

  assert.deepEqual(payload.result.archived, 2);
  assert.deepEqual(payload.result.deleted, 2);
  assert.deepEqual(payload.result.batches, 2);
  assert.equal(payload.stats.activeEvents, 1);
  assert.equal(payload.stats.archivedEvents, 2);
  assert.equal(payload.stats.pendingEvents, 1);
  assert.equal(payload.stats.appliedEvents, 0);
});
