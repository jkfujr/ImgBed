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
