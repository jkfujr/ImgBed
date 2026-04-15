import assert from 'node:assert/strict';
import test from 'node:test';

import { StorageOperationRecovery } from '../../src/storage/recovery/storage-operation-recovery.js';
import { createStorageOperationLifecycle } from '../../src/services/system/storage-operation-lifecycle.js';
import { buildQuotaEvent } from '../../src/services/system/storage-operations.js';
import {
  createStorageManagerDouble,
  createTestDb,
  getQuotaEvents,
  getStorageOperation,
  insertFileRecord,
} from '../helpers/storage-test-helpers.mjs';

test('恢复器可继续处理上传链留下的 compensation_pending 记录', async (t) => {
  const db = createTestDb();
  t.after(() => db.close());

  const storageManagerDouble = createStorageManagerDouble({
    deleteImpl: async () => true,
  });

  const lifecycle = createStorageOperationLifecycle({
    db,
    operationType: 'upload',
    fileId: 'file-recovery-upload',
    targetStorageId: 'storage-target',
    payload: { originalName: 'recovery.png' },
  });

  lifecycle.markRemoteDone({
    targetStorageId: 'storage-target',
    remotePayload: { storageKey: 'target-key' },
  });

  await assert.rejects(async () => lifecycle.commit({
    persist: () => {
      throw new Error('写入数据库失败');
    },
    targetStorageId: 'storage-target',
    failureCompensationPayload: { storageKey: 'target-key' },
    executeCompensation: async () => {
      throw new Error('首次回滚失败');
    },
  }), /写入数据库失败/);

  const recovery = new StorageOperationRecovery({
    db,
    getStorage: (storageId) => storageManagerDouble.manager.getStorage(storageId),
    applyPendingQuotaEvents: storageManagerDouble.manager.applyPendingQuotaEvents,
  });

  const recoveryResult = await recovery.recoverPendingOperations();
  const operation = getStorageOperation(db, lifecycle.operationId);

  assert.deepEqual(recoveryResult, {
    recovered: 1,
    total: 1,
    skipped: false,
  });
  assert.equal(operation.status, 'compensated');
  assert.deepEqual(storageManagerDouble.calls.deleteCalls, [{
    storageId: 'storage-target',
    storageKey: 'target-key',
    deleteToken: null,
  }]);
  assert.deepEqual(storageManagerDouble.calls.applyQuotaCalls, []);
});

test('恢复器可继续处理删除链 remote_done 状态并补做本地提交', async (t) => {
  const db = createTestDb();
  t.after(() => db.close());

  insertFileRecord(db, {
    id: 'file-recovery-delete',
    size: 512,
    storageKey: 'source-key',
    storageInstanceId: 'storage-source',
    deleteToken: { messageId: '1' },
  });

  const storageManagerDouble = createStorageManagerDouble();
  const lifecycle = createStorageOperationLifecycle({
    db,
    operationType: 'delete',
    fileId: 'file-recovery-delete',
    sourceStorageId: 'storage-source',
    payload: { storageKey: 'source-key', deleteMode: 'remote_and_index' },
  });

  lifecycle.markRemoteDone({
    sourceStorageId: 'storage-source',
    remotePayload: { storageKey: 'source-key', deleteMode: 'remote_and_index' },
  });

  const recovery = new StorageOperationRecovery({
    db,
    getStorage: (storageId) => storageManagerDouble.manager.getStorage(storageId),
    applyPendingQuotaEvents: storageManagerDouble.manager.applyPendingQuotaEvents,
  });

  const recoveryResult = await recovery.recoverPendingOperations();
  const operation = getStorageOperation(db, lifecycle.operationId);
  const fileRow = db.prepare('SELECT * FROM files WHERE id = ? LIMIT 1').get('file-recovery-delete');
  const quotaEvents = getQuotaEvents(db, lifecycle.operationId);

  assert.deepEqual(recoveryResult, {
    recovered: 1,
    total: 1,
    skipped: false,
  });
  assert.equal(operation.status, 'completed');
  assert.equal(fileRow, undefined);
  assert.equal(quotaEvents.length, 1);
  assert.equal(quotaEvents[0].event_type, 'delete');
  assert.equal(quotaEvents[0].bytes_delta, -512);
  assert.deepEqual(storageManagerDouble.calls.applyQuotaCalls, [{
    operationId: lifecycle.operationId,
    adjustUsageStats: true,
  }]);
  assert.deepEqual(storageManagerDouble.calls.deleteCalls, []);
});

test('恢复器可继续处理迁移链 committed 状态并延后清理源端对象', async (t) => {
  const db = createTestDb();
  t.after(() => db.close());

  const storageManagerDouble = createStorageManagerDouble({
    deleteImpl: async () => true,
  });

  const lifecycle = createStorageOperationLifecycle({
    db,
    applyPendingQuotaEvents: storageManagerDouble.manager.applyPendingQuotaEvents,
    operationType: 'migrate',
    fileId: 'file-recovery-migrate',
    sourceStorageId: 'storage-source',
    targetStorageId: 'storage-target',
    payload: { storageKey: 'source-key' },
  });

  lifecycle.markRemoteDone({
    sourceStorageId: 'storage-source',
    targetStorageId: 'storage-target',
    remotePayload: { storageKey: 'target-key' },
  });

  await assert.rejects(async () => lifecycle.commit({
    persist: () => {},
    quotaEvents: [
      buildQuotaEvent({
        operationId: lifecycle.operationId,
        fileId: 'file-recovery-migrate',
        storageId: 'storage-source',
        eventType: 'migrate_out',
        bytesDelta: -64,
        fileCountDelta: -1,
      }),
      buildQuotaEvent({
        operationId: lifecycle.operationId,
        fileId: 'file-recovery-migrate',
        storageId: 'storage-target',
        eventType: 'migrate_in',
        bytesDelta: 64,
        fileCountDelta: 1,
      }),
    ],
    sourceStorageId: 'storage-source',
    targetStorageId: 'storage-target',
    committedCompensationPayload: { storageKey: 'source-key' },
    afterCommit: async () => {
      throw new Error('源端延后清理失败');
    },
  }), /源端延后清理失败/);

  const recovery = new StorageOperationRecovery({
    db,
    getStorage: (storageId) => storageManagerDouble.manager.getStorage(storageId),
    applyPendingQuotaEvents: storageManagerDouble.manager.applyPendingQuotaEvents,
  });

  const recoveryResult = await recovery.recoverPendingOperations();
  const operation = getStorageOperation(db, lifecycle.operationId);

  assert.deepEqual(recoveryResult, {
    recovered: 1,
    total: 1,
    skipped: false,
  });
  assert.equal(operation.status, 'completed');
  assert.deepEqual(storageManagerDouble.calls.deleteCalls, [{
    storageId: 'storage-source',
    storageKey: 'source-key',
    deleteToken: null,
  }]);
  assert.deepEqual(storageManagerDouble.calls.applyQuotaCalls, [
    {
      operationId: lifecycle.operationId,
      adjustUsageStats: true,
    },
    {
      operationId: lifecycle.operationId,
      adjustUsageStats: true,
    },
  ]);
});
