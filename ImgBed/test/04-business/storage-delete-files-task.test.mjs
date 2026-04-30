import assert from 'node:assert/strict';
import test from 'node:test';

import {
  getFileById,
} from '../../src/database/files-dao.js';
import { createMaintenanceTaskExecutor } from '../../src/services/maintenance/maintenance-task-executor.js';
import {
  createTestDb,
  getQuotaEvents,
  getStorageOperation,
  insertFileRecord,
} from '../helpers/storage-test-helpers.mjs';
import {
  createTempAppRoot,
  resolveProjectModuleUrl,
} from '../helpers/runtime-test-helpers.mjs';

const appRoot = createTempAppRoot('imgbed-04-storage-delete-files-task-');
process.env.IMGBED_APP_ROOT = appRoot;

const configModule = await import(resolveProjectModuleUrl('src', 'config', 'index.js'));
configModule.loadStartupConfig();

const {
  createStorageDeleteFilesTaskDefinition,
  createStorageDeleteFilesTaskService,
  STORAGE_DELETE_FILES_TASK_TYPE,
} = await import(resolveProjectModuleUrl('src', 'services', 'tasks', 'storage-delete-files-task.js'));

function createLoggerDouble() {
  return {
    info() {},
    warn() {},
    error() {},
  };
}

function createTaskRuntime() {
  return {
    async processItems(items, processor, { onResult } = {}) {
      for (const [index, item] of items.entries()) {
        const result = await processor(item, { index });
        if (onResult) {
          await onResult(result, item, { index });
        }
      }
    },
    throwIfStopRequested() {},
    getStopRequest() {
      return null;
    },
  };
}

test('freeze 删除渠道文件任务会冻结源渠道 active 文件并跳过已变化文件', async (t) => {
  const db = createTestDb();
  t.after(() => db.close());
  const calls = [];

  insertFileRecord(db, {
    id: 'file-freeze-1',
    storageInstanceId: 'storage-delete-1',
  });
  insertFileRecord(db, {
    id: 'file-freeze-2',
    storageInstanceId: 'storage-delete-1',
  });
  insertFileRecord(db, {
    id: 'file-freeze-other',
    storageInstanceId: 'storage-other',
  });

  const taskId = 'task-freeze-1';
  db.prepare(`
    INSERT INTO task_logs (id, task_type, trigger_type, status, source_storage_id, total_count)
    VALUES (?, ?, 'automatic', 'pending', 'storage-delete-1', 2)
  `).run(taskId, STORAGE_DELETE_FILES_TASK_TYPE);
  const snapshots = [
    getFileById(db, 'file-freeze-1'),
    getFileById(db, 'file-freeze-2'),
  ];
  db.prepare("UPDATE files SET storage_instance_id = 'storage-other' WHERE id = 'file-freeze-2'").run();

  const definition = createStorageDeleteFilesTaskDefinition({
    db,
    storageManager: {
      async rebuildQuotaStats() {
        calls.push('rebuildQuotaStats');
      },
    },
    logger: createLoggerDouble(),
    countFilesByStorageInstance: () => 2,
    listFilesByStorageInstanceAfter: (_db, { afterId }) => (afterId ? [] : snapshots),
    invalidateFilesCache: () => calls.push('invalidateFiles'),
    invalidateStorageCaches: () => calls.push('invalidateStorages'),
    invalidateDashboardCaches: () => calls.push('invalidateDashboard'),
  });

  await definition.run({
    taskId,
    sourceStorageId: 'storage-delete-1',
    fileAction: 'freeze',
  }, createTaskRuntime());

  const task = db.prepare('SELECT * FROM task_logs WHERE id = ?').get(taskId);
  const items = db.prepare('SELECT * FROM task_log_items WHERE task_id = ? ORDER BY file_id ASC').all(taskId);

  assert.equal(task.task_type, STORAGE_DELETE_FILES_TASK_TYPE);
  assert.equal(task.trigger_type, 'automatic');
  assert.equal(task.status, 'completed');
  assert.equal(task.total_count, 2);
  assert.equal(task.success_count, 1);
  assert.equal(task.skipped_count, 1);
  assert.equal(getFileById(db, 'file-freeze-1').status, 'channel_deleted');
  assert.equal(getFileById(db, 'file-freeze-2').status, 'active');
  assert.equal(getFileById(db, 'file-freeze-other').status, 'active');
  assert.deepEqual(items.map((item) => ({ fileId: item.file_id, status: item.status })), [
    { fileId: 'file-freeze-1', status: 'success' },
    { fileId: 'file-freeze-2', status: 'skipped' },
  ]);
  assert.deepEqual(calls, [
    'rebuildQuotaStats',
    'invalidateFiles',
    'invalidateStorages',
    'invalidateDashboard',
  ]);
});

test('delete_records 删除渠道文件任务只清理数据库记录与分片，不删除远端对象', async (t) => {
  const db = createTestDb();
  t.after(() => db.close());
  const calls = {
    delete: [],
    applyQuota: [],
    invalidate: [],
  };

  insertFileRecord(db, {
    id: 'file-delete-records-1',
    storageInstanceId: 'storage-delete-1',
    storageKey: 'remote-key-1',
    isChunked: 1,
    chunkCount: 1,
    size: 32,
  });
  db.prepare(`
    INSERT INTO chunks (
      file_id, chunk_index, storage_type, storage_id, storage_key, storage_meta, size
    ) VALUES ('file-delete-records-1', 0, 'mock', 'storage-delete-1', 'chunk-key-1', NULL, 32)
  `).run();
  db.prepare(`
    INSERT INTO access_logs (file_id, ip, is_admin)
    VALUES ('file-delete-records-1', '127.0.0.1', 0)
  `).run();

  const service = createStorageDeleteFilesTaskService({
    db,
    storageManager: {
      getStorage(storageId) {
        return {
          async delete(storageKey, deleteToken) {
            calls.delete.push({ storageId, storageKey, deleteToken });
            return true;
          },
        };
      },
      async applyPendingQuotaEvents(options) {
        calls.applyQuota.push(options);
        return { applied: 1, storageIds: ['storage-delete-1'] };
      },
    },
    logger: createLoggerDouble(),
    taskExecutor: createMaintenanceTaskExecutor({ logger: createLoggerDouble(), wait: async () => {} }),
    invalidateFilesCache: () => calls.invalidate.push('files'),
    invalidateStorageCaches: () => calls.invalidate.push('storages'),
    invalidateDashboardCaches: () => calls.invalidate.push('dashboard'),
  });

  const started = service.startStorageDeleteFilesTask({
    sourceStorageId: 'storage-delete-1',
    fileAction: 'delete_records',
  });

  await new Promise((resolve) => setTimeout(resolve, 0));

  const task = db.prepare('SELECT * FROM task_logs WHERE id = ?').get(started.taskId);
  const operation = getStorageOperation(db, db.prepare('SELECT id FROM storage_operations LIMIT 1').get().id);
  const quotaEvents = getQuotaEvents(db, operation.id);

  assert.equal(task.status, 'completed');
  assert.equal(task.success_count, 1);
  assert.equal(getFileById(db, 'file-delete-records-1'), undefined);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM chunks WHERE file_id = ?').get('file-delete-records-1').count, 0);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM access_logs WHERE file_id = ?').get('file-delete-records-1').count, 0);
  assert.deepEqual(calls.delete, []);
  assert.equal(calls.applyQuota.length, 1);
  assert.equal(operation.status, 'completed');
  assert.equal(quotaEvents[0].event_type, 'delete');
  assert.deepEqual(calls.invalidate, ['files', 'storages', 'dashboard']);
});

test('删除渠道文件任务会记录失败项具体错误', async (t) => {
  const db = createTestDb();
  t.after(() => db.close());

  insertFileRecord(db, {
    id: 'file-delete-fail-1',
    storageInstanceId: 'storage-delete-1',
  });

  const taskId = 'task-delete-fail-1';
  db.prepare(`
    INSERT INTO task_logs (id, task_type, trigger_type, status, source_storage_id, total_count)
    VALUES (?, ?, 'automatic', 'pending', 'storage-delete-1', 1)
  `).run(taskId, STORAGE_DELETE_FILES_TASK_TYPE);
  const definition = createStorageDeleteFilesTaskDefinition({
    db,
    storageManager: {},
    logger: createLoggerDouble(),
    deleteFileRecord: async () => {
      throw new Error('清理失败');
    },
  });

  await definition.run({
    taskId,
    sourceStorageId: 'storage-delete-1',
    fileAction: 'delete_records',
  }, createTaskRuntime());

  const task = db.prepare('SELECT * FROM task_logs WHERE id = ?').get(taskId);
  const item = db.prepare('SELECT * FROM task_log_items WHERE task_id = ?').get(taskId);

  assert.equal(task.status, 'failed');
  assert.equal(task.failed_count, 1);
  assert.match(task.error_summary, /file-delete-fail-1: 清理失败/);
  assert.equal(item.status, 'failed');
  assert.equal(item.last_error, '清理失败');
});

test('删除渠道文件任务只允许取消 pending/running 任务', (t) => {
  const db = createTestDb();
  const calls = [];
  t.after(() => db.close());

  const service = createStorageDeleteFilesTaskService({
    db,
    storageManager: {},
    logger: createLoggerDouble(),
    taskExecutor: {
      registerTask() {},
      getSnapshot() {
        return null;
      },
      requestStop(name, options) {
        calls.push({ name, options });
      },
      start() {},
    },
  });

  db.prepare(`
    INSERT INTO task_logs (id, task_type, trigger_type, status, source_storage_id, total_count)
    VALUES ('task-delete-running-1', ?, 'automatic', 'running', 'storage-delete-1', 1)
  `).run(STORAGE_DELETE_FILES_TASK_TYPE);
  db.prepare(`
    INSERT INTO task_log_items (id, task_id, file_id, status)
    VALUES ('item-delete-running-1', 'task-delete-running-1', 'file-1', 'running')
  `).run();

  const cancelled = service.cancelStorageDeleteFilesTask('task-delete-running-1');
  const task = db.prepare('SELECT * FROM task_logs WHERE id = ?').get('task-delete-running-1');
  const item = db.prepare('SELECT * FROM task_log_items WHERE id = ?').get('item-delete-running-1');

  assert.equal(cancelled.status, 'cancelled');
  assert.equal(task.status, 'cancelled');
  assert.equal(item.status, 'cancelled');
  assert.deepEqual(calls, [{
    name: 'storage-delete-files',
    options: {
      action: 'cancel',
      reason: '用户取消任务',
    },
  }]);
});

test('删除渠道文件任务服务会拒绝非法 fileAction', (t) => {
  const db = createTestDb();
  t.after(() => db.close());

  const service = createStorageDeleteFilesTaskService({
    db,
    storageManager: {},
    logger: createLoggerDouble(),
    taskExecutor: {
      registerTask() {},
      getSnapshot() {
        return null;
      },
      requestStop() {},
      start() {},
    },
  });

  assert.throws(
    () => service.startStorageDeleteFilesTask({
      sourceStorageId: 'storage-delete-1',
      fileAction: 'bad-action',
    }),
    /file_action 参数必须是 freeze 或 delete_records/,
  );
});
