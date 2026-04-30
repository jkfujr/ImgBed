import assert from 'node:assert/strict';
import test from 'node:test';

import crypto from 'node:crypto';
import { Readable } from 'node:stream';

import { getFileById } from '../../src/database/files-dao.js';
import { createMaintenanceTaskExecutor } from '../../src/services/maintenance/maintenance-task-executor.js';
import {
  createTestDb,
  getStorageOperation,
  insertFileRecord,
} from '../helpers/storage-test-helpers.mjs';
import {
  createLoggerDouble,
  createTempAppRoot,
  resolveProjectModuleUrl,
} from '../helpers/runtime-test-helpers.mjs';

const appRoot = createTempAppRoot('imgbed-04-channel-migration-task-');
process.env.IMGBED_APP_ROOT = appRoot;

const configModule = await import(resolveProjectModuleUrl('src', 'config', 'index.js'));
configModule.loadStartupConfig();

const {
  createChannelMigrationTaskDefinition,
  createChannelMigrationTaskService,
} = await import(resolveProjectModuleUrl('src', 'services', 'tasks', 'channel-migration-task.js'));

function createStorageManager(calls = {}) {
  const sourceStorage = {
    async getStreamResponse() {
      return { stream: Readable.from([Buffer.from('demo')]) };
    },
    async delete(storageKey, deleteToken) {
      calls.sourceDeletes.push({ storageKey, deleteToken });
      return true;
    },
    getChunkConfig() {
      return { enabled: false, chunkThreshold: Number.MAX_SAFE_INTEGER, chunkSize: 1024, maxChunks: 10 };
    },
  };
  const targetStorage = {
    async put(stream) {
      for await (const _chunk of stream) {
        // 读取流以完成写入模拟。
      }
      calls.targetPuts.push('put');
      return { storageKey: 'target-key', deleteToken: null };
    },
    getChunkConfig() {
      return { enabled: false, chunkThreshold: Number.MAX_SAFE_INTEGER, chunkSize: 1024, maxChunks: 10 };
    },
  };
  const entries = {
    'source-1': { id: 'source-1', type: 'local', allowUpload: false, instance: sourceStorage },
    'target-1': { id: 'target-1', type: 's3', allowUpload: true, instance: targetStorage },
  };

  return {
    getStorageMeta(storageId) {
      return entries[storageId] || null;
    },
    getStorage(storageId) {
      return entries[storageId]?.instance || null;
    },
    isUploadAllowed(storageId) {
      return storageId === 'target-1';
    },
    getEffectiveUploadLimits() {
      return {
        enableSizeLimit: false,
        sizeLimitMB: 10,
        enableChunking: false,
        chunkSizeMB: 5,
        maxChunks: 0,
        enableMaxLimit: false,
        maxLimitMB: 100,
      };
    },
    async applyPendingQuotaEvents() {
      return { applied: 2, storageIds: ['source-1', 'target-1'] };
    },
  };
}

test('渠道迁移任务会迁移源渠道 active 文件并保留源端对象', async (t) => {
  const db = createTestDb();
  t.after(() => db.close());
  const calls = { sourceDeletes: [], targetPuts: [] };
  const storageManager = createStorageManager(calls);
  const { logger } = createLoggerDouble();

  insertFileRecord(db, {
    id: 'file-channel-1',
    storageInstanceId: 'source-1',
    storageKey: 'source-key',
    size: 4,
  });
  insertFileRecord(db, {
    id: 'file-other-1',
    storageInstanceId: 'other-1',
    storageKey: 'other-key',
    size: 4,
  });

  const executor = createMaintenanceTaskExecutor({ logger, wait: async () => {} });
  const service = createChannelMigrationTaskService({
    db,
    storageManager,
    logger,
    taskExecutor: executor,
    applyPendingQuotaEvents: storageManager.applyPendingQuotaEvents,
  });

  const started = service.startChannelMigration({
    sourceChannel: 'source-1',
    targetChannel: 'target-1',
  });

  assert.equal(started.status, 'processing');
  await new Promise((resolve) => setTimeout(resolve, 0));

  const task = db.prepare('SELECT * FROM task_logs WHERE id = ?').get(started.taskId);
  const migrated = getFileById(db, 'file-channel-1');
  const untouched = getFileById(db, 'file-other-1');
  const operation = getStorageOperation(db, db.prepare('SELECT id FROM storage_operations LIMIT 1').get().id);

  assert.equal(task.status, 'completed');
  assert.equal(task.total_count, 1);
  assert.equal(task.success_count, 1);
  assert.equal(task.failed_count, 0);
  assert.equal(migrated.storage_instance_id, 'target-1');
  assert.equal(untouched.storage_instance_id, 'other-1');
  assert.deepEqual(calls.sourceDeletes, []);
  assert.equal(operation.compensation_payload, null);
});

test('渠道迁移任务会对失败文件重试 3 次并记录失败项', async (t) => {
  const db = createTestDb();
  t.after(() => db.close());
  const { logger } = createLoggerDouble();

  insertFileRecord(db, {
    id: 'file-fail-1',
    storageInstanceId: 'source-1',
    storageKey: 'source-key',
    size: 4,
  });

  const taskId = crypto.randomUUID();
  db.prepare(`
    INSERT INTO task_logs (id, task_type, status, source_storage_id, target_storage_id, total_count)
    VALUES (?, 'channel_migration', 'pending', 'source-1', 'target-1', 1)
  `).run(taskId);

  const storageManager = {
    getStorageMeta(storageId) {
      if (storageId === 'source-1') return { id: 'source-1', type: 'local', instance: {} };
      if (storageId === 'target-1') return { id: 'target-1', type: 's3', instance: {} };
      return null;
    },
    isUploadAllowed(storageId) {
      return storageId === 'target-1';
    },
  };
  let attempts = 0;
  const definition = createChannelMigrationTaskDefinition({
    db,
    storageManager,
    logger,
    fileMigrationService: {
      async migrateFileRecord() {
        attempts += 1;
        throw new Error('写入失败');
      },
    },
  });

  await definition.run({
    taskId,
    sourceChannel: 'source-1',
    targetChannel: 'target-1',
  }, {
    async processItems(items, processor, options = {}) {
      for (let index = 0; index < items.length; index += 1) {
        const result = await processor(items[index], { index });
        await options.onResult?.(result, items[index], { index });
      }
    },
  });

  const task = db.prepare('SELECT * FROM task_logs WHERE id = ?').get(taskId);
  const item = db.prepare('SELECT * FROM task_log_items WHERE task_id = ?').get(taskId);

  assert.equal(attempts, 3);
  assert.equal(task.status, 'failed');
  assert.equal(task.failed_count, 1);
  assert.equal(item.status, 'failed');
  assert.equal(item.attempt_count, 3);
  assert.equal(item.last_error, '写入失败');
});

test('渠道迁移任务会让单文件迁移超时进入失败统计', async (t) => {
  const db = createTestDb();
  t.after(() => db.close());
  const { logger } = createLoggerDouble();

  insertFileRecord(db, {
    id: 'file-timeout-1',
    storageInstanceId: 'source-1',
    storageKey: 'source-key',
    size: 4,
  });

  const taskId = crypto.randomUUID();
  db.prepare(`
    INSERT INTO task_logs (id, task_type, status, source_storage_id, target_storage_id, total_count)
    VALUES (?, 'channel_migration', 'pending', 'source-1', 'target-1', 1)
  `).run(taskId);

  const storageManager = createStorageManager({ sourceDeletes: [], targetPuts: [] });
  const definition = createChannelMigrationTaskDefinition({
    db,
    storageManager,
    logger,
    maxAttempts: 1,
    itemTimeoutMs: 5,
    fileMigrationService: {
      async migrateFileRecord(_file, options = {}) {
        await new Promise((resolve, reject) => {
          options.signal?.addEventListener('abort', () => {
            reject(options.signal.reason);
          }, { once: true });
        });
      },
    },
  });

  await definition.run({
    taskId,
    sourceChannel: 'source-1',
    targetChannel: 'target-1',
  }, {
    async processItems(items, processor, options = {}) {
      for (let index = 0; index < items.length; index += 1) {
        const result = await processor(items[index], { index });
        await options.onResult?.(result, items[index], { index });
      }
    },
  });

  const task = db.prepare('SELECT * FROM task_logs WHERE id = ?').get(taskId);
  const item = db.prepare('SELECT * FROM task_log_items WHERE task_id = ?').get(taskId);

  assert.equal(task.status, 'failed');
  assert.equal(task.failed_count, 1);
  assert.equal(item.status, 'failed');
  assert.match(item.last_error, /迁移超时/);
});


test('渠道迁移任务收到暂停请求后会停止后续文件并记录 paused', async (t) => {
  const db = createTestDb();
  t.after(() => db.close());
  const { logger } = createLoggerDouble();

  insertFileRecord(db, {
    id: 'file-pause-1',
    storageInstanceId: 'source-1',
    storageKey: 'source-key-1',
    size: 4,
  });
  insertFileRecord(db, {
    id: 'file-pause-2',
    storageInstanceId: 'source-1',
    storageKey: 'source-key-2',
    size: 4,
  });

  const taskId = crypto.randomUUID();
  db.prepare(`
    INSERT INTO task_logs (id, task_type, status, source_storage_id, target_storage_id, total_count)
    VALUES (?, 'channel_migration', 'pending', 'source-1', 'target-1', 2)
  `).run(taskId);

  const storageManager = createStorageManager({ sourceDeletes: [], targetPuts: [] });
  const executor = createMaintenanceTaskExecutor({ logger, wait: async () => {} });
  let migrationStarted;
  const migrationStartedPromise = new Promise((resolve) => {
    migrationStarted = resolve;
  });
  const definition = createChannelMigrationTaskDefinition({
    db,
    storageManager,
    logger,
    itemTimeoutMs: 1000,
    fileMigrationService: {
      async migrateFileRecord(_file, options = {}) {
        migrationStarted();
        await new Promise((resolve, reject) => {
          options.signal?.addEventListener('abort', () => {
            reject(options.signal.reason);
          }, { once: true });
        });
      },
    },
  });
  executor.registerTask({
    ...definition,
    concurrency: 1,
  });

  executor.start('channel-migration', {
    taskId,
    sourceChannel: 'source-1',
    targetChannel: 'target-1',
  });
  await migrationStartedPromise;
  executor.requestStop('channel-migration', {
    action: 'pause',
    reason: '测试暂停',
  });
  await new Promise((resolve) => setTimeout(resolve, 0));

  const task = db.prepare('SELECT * FROM task_logs WHERE id = ?').get(taskId);
  const items = db.prepare('SELECT * FROM task_log_items WHERE task_id = ? ORDER BY file_id ASC').all(taskId);

  assert.equal(task.status, 'paused');
  assert.equal(task.success_count, 0);
  assert.equal(items.every((item) => item.status !== 'running' && item.status !== 'retrying'), true);
  assert.equal(items[0].status, 'paused');
});

test('渠道迁移服务可以取消运行中任务并从终态任务创建重试任务', async (t) => {
  const db = createTestDb();
  t.after(() => db.close());
  const { logger } = createLoggerDouble();
  const calls = { stops: [], starts: [] };
  const storageManager = createStorageManager({ sourceDeletes: [], targetPuts: [] });
  const service = createChannelMigrationTaskService({
    db,
    storageManager,
    logger,
    taskExecutor: {
      registerTask() {},
      getSnapshot() {
        return null;
      },
      requestStop(name, options) {
        calls.stops.push({ name, options });
      },
      start(name, input) {
        calls.starts.push({ name, input });
      },
    },
  });

  const taskId = crypto.randomUUID();
  db.prepare(`
    INSERT INTO task_logs (id, task_type, status, source_storage_id, target_storage_id, total_count)
    VALUES (?, 'channel_migration', 'running', 'source-1', 'target-1', 1)
  `).run(taskId);

  const cancelled = service.stopChannelMigration(taskId, { action: 'cancel' });
  const stoppedTask = db.prepare('SELECT * FROM task_logs WHERE id = ?').get(taskId);

  assert.equal(cancelled.status, 'cancelled');
  assert.equal(stoppedTask.status, 'cancelled');
  assert.deepEqual(calls.stops, [{
    name: 'channel-migration',
    options: {
      action: 'cancel',
      reason: '用户取消任务',
    },
  }]);

  const retried = service.retryChannelMigration(taskId);

  assert.equal(retried.status, 'processing');
  assert.notEqual(retried.taskId, taskId);
  assert.equal(calls.starts.length, 1);
  assert.deepEqual(calls.starts[0].input, {
    taskId: retried.taskId,
    sourceChannel: 'source-1',
    targetChannel: 'target-1',
  });
});
