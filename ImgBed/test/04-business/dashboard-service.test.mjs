import assert from 'node:assert/strict';
import test from 'node:test';

import { createDashboardService } from '../../src/services/system/dashboard-service.js';
import { createTestDb, insertFileRecord } from '../helpers/storage-test-helpers.mjs';

function insertAccessLog(db, {
  fileId = 'file-1',
  ip = '127.0.0.1',
  isAdmin = 0,
  createdAt,
} = {}) {
  db.prepare(`
    INSERT INTO access_logs (file_id, ip, user_agent, referer, is_admin, created_at)
    VALUES (?, ?, NULL, NULL, ?, ?)
  `).run(fileId, ip, isAdmin, createdAt);
}

function createService(db) {
  return createDashboardService({
    db,
    readRuntimeConfig: () => ({ storage: { storages: [] } }),
    getActiveFilesStats: () => ({ count: 1, sum: 123 }),
    getTodayUploadCount: () => 0,
    getUploadTrend: () => [],
    summarizeStorages: () => ({ total: 0, enabled: 0 }),
  });
}

test('dashboard 访问统计按本地自然日窗口读取 access_logs', (t) => {
  const db = createTestDb();
  t.after(() => db.close());

  insertFileRecord(db, { id: 'file-1', fileName: 'file-1.png' });
  insertFileRecord(db, { id: 'file-2', fileName: 'file-2.png' });

  const todayStart = db.prepare("SELECT datetime('now', 'localtime', 'start of day', 'utc') AS value").get().value;
  const beforeToday = db.prepare("SELECT datetime('now', 'localtime', 'start of day', '-1 second', 'utc') AS value").get().value;
  const sevenDayStart = db.prepare("SELECT datetime('now', 'localtime', 'start of day', '-6 days', 'utc') AS value").get().value;
  const beforeSevenDayStart = db.prepare("SELECT datetime('now', 'localtime', 'start of day', '-6 days', '-1 second', 'utc') AS value").get().value;

  insertAccessLog(db, {
    fileId: 'file-1',
    ip: '10.0.0.1',
    isAdmin: 0,
    createdAt: todayStart,
  });
  insertAccessLog(db, {
    fileId: 'file-1',
    ip: '10.0.0.2',
    isAdmin: 1,
    createdAt: todayStart,
  });
  insertAccessLog(db, {
    fileId: 'file-1',
    ip: '10.0.0.3',
    isAdmin: null,
    createdAt: todayStart,
  });
  insertAccessLog(db, {
    fileId: 'file-1',
    ip: '10.0.0.4',
    isAdmin: 0,
    createdAt: beforeToday,
  });
  insertAccessLog(db, {
    fileId: 'file-2',
    ip: '10.0.0.5',
    isAdmin: 0,
    createdAt: sevenDayStart,
  });
  insertAccessLog(db, {
    fileId: 'file-2',
    ip: '10.0.0.6',
    isAdmin: 0,
    createdAt: beforeSevenDayStart,
  });

  const service = createService(db);
  const overview = service.getOverview();
  const stats = service.getAccessStats();

  assert.equal(overview.todayAccess, 3);
  assert.equal(stats.todayAccess, 1);
  assert.equal(stats.todayVisitors, 1);
  assert.deepEqual(
    stats.topFiles.map((row) => ({ fileId: row.fileId, accessCount: row.accessCount })),
    [
      { fileId: 'file-1', accessCount: 2 },
      { fileId: 'file-2', accessCount: 1 },
    ],
  );
});
