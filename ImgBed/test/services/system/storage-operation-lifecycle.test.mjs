import assert from 'node:assert/strict';
import test from 'node:test';

import {
  COMMIT_FAILURE_MODE,
  createStorageOperationLifecycle,
} from '../../../src/services/system/storage-operation-lifecycle.js';
import { buildQuotaEvent } from '../../../src/services/system/storage-operations.js';
import {
  createStorageManagerDouble,
  createTestDb,
  getQuotaEvents,
  getStorageOperation,
} from '../../helpers/storage-test-helpers.mjs';

test('上传成功时按 pending -> remote_done -> committed -> completed 推进', async (t) => {
  const db = createTestDb();
  t.after(() => db.close());

  const storageManagerDouble = createStorageManagerDouble();
  const lifecycle = createStorageOperationLifecycle({
    db,
    storageManager: storageManagerDouble.manager,
    operationType: 'upload',
    fileId: 'file-upload-success',
    targetStorageId: 'storage-target',
    payload: { originalName: 'demo.png' },
  });

  lifecycle.markRemoteDone({
    targetStorageId: 'storage-target',
    remotePayload: { storageKey: 'remote-upload-key' },
  });

  await lifecycle.commit({
    persist: () => {},
    quotaEvents: [buildQuotaEvent({
      operationId: lifecycle.operationId,
      fileId: 'file-upload-success',
      storageId: 'storage-target',
      eventType: 'upload',
      bytesDelta: 128,
      fileCountDelta: 1,
      payload: { storageKey: 'remote-upload-key' },
    })],
    targetStorageId: 'storage-target',
  });

  const operation = getStorageOperation(db, lifecycle.operationId);
  const quotaEvents = getQuotaEvents(db, lifecycle.operationId);

  assert.equal(operation.status, 'completed');
  assert.deepEqual(operation.remote_payload, { storageKey: 'remote-upload-key' });
  assert.equal(operation.compensation_payload, null);
  assert.equal(quotaEvents.length, 1);
  assert.deepEqual(storageManagerDouble.calls.applyQuotaCalls, [{
    operationId: lifecycle.operationId,
    adjustUsageStats: true,
  }]);
});

test('上传提交失败且立即补偿成功时保留原始错误并标记 compensated', async (t) => {
  const db = createTestDb();
  t.after(() => db.close());

  const lifecycle = createStorageOperationLifecycle({
    db,
    operationType: 'upload',
    fileId: 'file-upload-compensated',
    targetStorageId: 'storage-target',
    payload: { originalName: 'broken.png' },
  });

  lifecycle.markRemoteDone({
    targetStorageId: 'storage-target',
    remotePayload: { storageKey: 'remote-broken-key' },
  });

  const cleanupCalls = [];

  await assert.rejects(async () => lifecycle.commit({
    persist: () => {
      throw new Error('写入数据库失败');
    },
    targetStorageId: 'storage-target',
    failureCompensationPayload: { storageKey: 'remote-broken-key' },
    executeCompensation: async () => {
      cleanupCalls.push('cleanup');
    },
  }), /写入数据库失败/);

  const operation = getStorageOperation(db, lifecycle.operationId);

  assert.deepEqual(cleanupCalls, ['cleanup']);
  assert.equal(operation.status, 'compensated');
  assert.deepEqual(operation.compensation_payload, { storageKey: 'remote-broken-key' });
});

test('上传提交失败且立即补偿失败时保留 compensation_pending 供恢复器继续处理', async (t) => {
  const db = createTestDb();
  t.after(() => db.close());

  const lifecycle = createStorageOperationLifecycle({
    db,
    operationType: 'upload',
    fileId: 'file-upload-pending',
    targetStorageId: 'storage-target',
    payload: { originalName: 'pending.png' },
  });

  lifecycle.markRemoteDone({
    targetStorageId: 'storage-target',
    remotePayload: { storageKey: 'remote-pending-key' },
  });

  await assert.rejects(async () => lifecycle.commit({
    persist: () => {
      throw new Error('写入数据库失败');
    },
    targetStorageId: 'storage-target',
    failureCompensationPayload: { storageKey: 'remote-pending-key' },
    executeCompensation: async () => {
      throw new Error('远端回滚失败');
    },
  }), /写入数据库失败/);

  const operation = getStorageOperation(db, lifecycle.operationId);

  assert.equal(operation.status, 'compensation_pending');
  assert.equal(operation.error_message, '写入数据库失败');
  assert.deepEqual(operation.compensation_payload, { storageKey: 'remote-pending-key' });
});

test('删除链提交失败时保留 remote_done 状态供恢复器补做本地删除', async (t) => {
  const db = createTestDb();
  t.after(() => db.close());

  const lifecycle = createStorageOperationLifecycle({
    db,
    operationType: 'delete',
    fileId: 'file-delete-remote-done',
    sourceStorageId: 'storage-source',
    payload: { storageKey: 'remote-delete-key', deleteMode: 'remote_and_index' },
  });

  lifecycle.markRemoteDone({
    sourceStorageId: 'storage-source',
    remotePayload: { storageKey: 'remote-delete-key', deleteMode: 'remote_and_index' },
  });

  await assert.rejects(async () => lifecycle.commit({
    persist: () => {
      throw new Error('删除索引失败');
    },
    sourceStorageId: 'storage-source',
    committedCompensationPayload: { storageKey: 'remote-delete-key', deleteMode: 'remote_and_index' },
    onCommitFailure: COMMIT_FAILURE_MODE.LEAVE_REMOTE_DONE,
  }), /删除索引失败/);

  const operation = getStorageOperation(db, lifecycle.operationId);

  assert.equal(operation.status, 'remote_done');
  assert.equal(operation.compensation_payload, null);
  assert.deepEqual(operation.remote_payload, { storageKey: 'remote-delete-key', deleteMode: 'remote_and_index' });
});

test('迁移链在提交成功后源端清理失败时保留 committed 状态', async (t) => {
  const db = createTestDb();
  t.after(() => db.close());

  const storageManagerDouble = createStorageManagerDouble();
  const lifecycle = createStorageOperationLifecycle({
    db,
    storageManager: storageManagerDouble.manager,
    operationType: 'migrate',
    fileId: 'file-migrate-committed',
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
    quotaEvents: [buildQuotaEvent({
      operationId: lifecycle.operationId,
      fileId: 'file-migrate-committed',
      storageId: 'storage-target',
      eventType: 'migrate_in',
      bytesDelta: 256,
      fileCountDelta: 1,
    })],
    sourceStorageId: 'storage-source',
    targetStorageId: 'storage-target',
    committedCompensationPayload: { storageKey: 'source-key' },
    afterCommit: async () => {
      throw new Error('源端清理失败');
    },
  }), /源端清理失败/);

  const operation = getStorageOperation(db, lifecycle.operationId);

  assert.equal(operation.status, 'committed');
  assert.deepEqual(operation.compensation_payload, { storageKey: 'source-key' });
  assert.deepEqual(storageManagerDouble.calls.applyQuotaCalls, [{
    operationId: lifecycle.operationId,
    adjustUsageStats: true,
  }]);
});
