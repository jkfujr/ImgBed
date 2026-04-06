import test from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import fs from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

import {
  createStorageOperation,
  markOperationRemoteDone,
  markOperationCommitted,
  markOperationCompensationPending,
  markOperationCompensated,
  markOperationCompleted,
  markOperationFailed,
  buildQuotaEvent,
  insertQuotaEvents,
} from '../src/services/system/storage-operations.js';

import { StorageManager } from '../src/storage/manager.js';

// ============================================================
// 工具函数
// ============================================================

function createTestDatabase() {
  const dbPath = join(__dirname, `test-recovery-${Date.now()}-${Math.random().toString(36).slice(2, 6)}.db`);
  const db = new Database(dbPath);

  db.exec(`
    CREATE TABLE IF NOT EXISTS storage_operations (
      id TEXT PRIMARY KEY,
      operation_type TEXT NOT NULL,
      file_id TEXT,
      source_storage_id TEXT,
      target_storage_id TEXT,
      status TEXT NOT NULL DEFAULT 'pending',
      remote_payload TEXT,
      compensation_payload TEXT,
      error_message TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS storage_quota_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      operation_id TEXT NOT NULL,
      file_id TEXT,
      storage_id TEXT NOT NULL,
      event_type TEXT NOT NULL,
      bytes_delta INTEGER NOT NULL DEFAULT 0,
      file_count_delta INTEGER NOT NULL DEFAULT 0,
      idempotency_key TEXT UNIQUE,
      payload TEXT,
      applied_at TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS storage_quota_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      storage_id TEXT NOT NULL,
      bytes_used INTEGER NOT NULL DEFAULT 0,
      file_count INTEGER NOT NULL DEFAULT 0,
      snapshot_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS files (
      id TEXT PRIMARY KEY,
      file_name TEXT NOT NULL,
      original_name TEXT NOT NULL,
      mime_type TEXT,
      size INTEGER NOT NULL,
      storage_channel TEXT NOT NULL,
      storage_key TEXT NOT NULL,
      storage_config TEXT,
      storage_instance_id TEXT,
      is_chunked INTEGER DEFAULT 0,
      chunk_count INTEGER DEFAULT 0,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS chunks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      file_id TEXT NOT NULL,
      chunk_index INTEGER NOT NULL,
      storage_id TEXT NOT NULL,
      storage_key TEXT NOT NULL,
      size INTEGER NOT NULL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );
  `);

  return { db, dbPath };
}

function cleanupTestDatabase(dbPath) {
  try {
    if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath);
  } catch { /* 忽略 */ }
}

/** 创建带 mock 存储的 StorageManager 实例 */
function createTestManager(db, mockStorage = null) {
  const manager = new StorageManager({ db, autoInit: false });

  // stub applyPendingQuotaEvents，避免读取全局 sqlite
  manager.applyPendingQuotaEvents = async () => {};

  const storage = mockStorage || {
    delete: async () => true,
    deleteChunk: async () => true,
  };

  manager.instances.set('local-main', {
    instance: storage,
    type: 'local',
    allowUpload: true,
    weight: 1,
    quotaLimitGB: null,
    disableThresholdPercent: 95,
  });

  manager.instances.set('s3-backup', {
    instance: storage,
    type: 's3',
    allowUpload: true,
    weight: 1,
    quotaLimitGB: null,
    disableThresholdPercent: 95,
  });

  return manager;
}

function getOperationStatus(db, operationId) {
  return db.prepare('SELECT * FROM storage_operations WHERE id = ?').get(operationId);
}

function insertTestFileRecord(db, { id, storageInstanceId = 'local-main', storageKey = 'test-key', size = 1024 }) {
  db.prepare(`
    INSERT INTO files (id, file_name, original_name, mime_type, size, storage_channel, storage_key, storage_config, storage_instance_id, is_chunked, chunk_count)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0)
  `).run(id, `${id}.jpg`, `${id}.jpg`, 'image/jpeg', size, 'local', storageKey, JSON.stringify({ instance_id: storageInstanceId }), storageInstanceId);
}

// ============================================================
// 测试: compensation_pending 恢复
// ============================================================

test('恢复调度: compensation_pending 状态操作被正确补偿', async () => {
  const { db, dbPath } = createTestDatabase();
  const deletedKeys = [];

  try {
    const mockStorage = {
      delete: async (key) => { deletedKeys.push(key); return true; },
      deleteChunk: async (key) => { deletedKeys.push(key); return true; },
    };
    const manager = createTestManager(db, mockStorage);

    // 插入一条 compensation_pending 操作
    const opId = createStorageOperation(db, {
      operationType: 'upload',
      fileId: 'file-cp-1',
      sourceStorageId: 'local-main',
    });
    markOperationCompensationPending(db, opId, {
      sourceStorageId: 'local-main',
      compensationPayload: {
        storageId: 'local-main',
        storageKey: 'uploaded-key-1',
        isChunked: false,
        chunkRecords: [],
      },
      error: new Error('本地事务失败'),
    });

    const result = await manager._recoverStaleOperations();

    assert.equal(result.recovered, 1);
    assert.equal(result.total, 1);
    assert.equal(result.skipped, false);

    const op = getOperationStatus(db, opId);
    assert.equal(op.status, 'compensated');
    assert.ok(deletedKeys.includes('uploaded-key-1'));
  } finally {
    db.close();
    cleanupTestDatabase(dbPath);
  }
});

// ============================================================
// 测试: remote_done 恢复 (非 delete 类型 → 清理远端)
// ============================================================

test('恢复调度: remote_done 上传操作 → 清理远端并标记 compensated', async () => {
  const { db, dbPath } = createTestDatabase();
  const deletedKeys = [];

  try {
    const mockStorage = {
      delete: async (key) => { deletedKeys.push(key); return true; },
      deleteChunk: async () => true,
    };
    const manager = createTestManager(db, mockStorage);

    const opId = createStorageOperation(db, {
      operationType: 'upload',
      fileId: 'file-rd-1',
      sourceStorageId: 'local-main',
    });
    markOperationRemoteDone(db, opId, {
      sourceStorageId: 'local-main',
      remotePayload: {
        storageId: 'local-main',
        storageKey: 'remote-upload-key',
        isChunked: false,
        chunkRecords: [],
      },
    });

    await manager._recoverStaleOperations();

    const op = getOperationStatus(db, opId);
    assert.equal(op.status, 'compensated');
    assert.ok(deletedKeys.includes('remote-upload-key'));
  } finally {
    db.close();
    cleanupTestDatabase(dbPath);
  }
});

// ============================================================
// 测试: remote_done 恢复 (delete 类型 → 补做本地删除)
// ============================================================

test('恢复调度: remote_done 删除操作 → 补做本地删除并标记 completed', async () => {
  const { db, dbPath } = createTestDatabase();

  try {
    const manager = createTestManager(db);

    // 插入文件记录（模拟远端已清理但本地未删除的场景）
    insertTestFileRecord(db, { id: 'file-rd-del', storageKey: 'del-key', size: 2048 });

    const opId = createStorageOperation(db, {
      operationType: 'delete',
      fileId: 'file-rd-del',
      sourceStorageId: 'local-main',
    });
    markOperationRemoteDone(db, opId, {
      sourceStorageId: 'local-main',
      remotePayload: { deletedAt: '2026-01-01' },
    });

    await manager._recoverStaleOperations();

    const op = getOperationStatus(db, opId);
    assert.equal(op.status, 'completed');

    // 验证文件记录已被删除
    const file = db.prepare('SELECT * FROM files WHERE id = ?').get('file-rd-del');
    assert.equal(file, undefined);
  } finally {
    db.close();
    cleanupTestDatabase(dbPath);
  }
});

test('恢复调度: remote_done 删除操作但文件不存在 → 直接标记 completed', async () => {
  const { db, dbPath } = createTestDatabase();

  try {
    const manager = createTestManager(db);

    const opId = createStorageOperation(db, {
      operationType: 'delete',
      fileId: 'file-nonexistent',
      sourceStorageId: 'local-main',
    });
    markOperationRemoteDone(db, opId, {
      sourceStorageId: 'local-main',
      remotePayload: { deletedAt: '2026-01-01' },
    });

    await manager._recoverStaleOperations();

    const op = getOperationStatus(db, opId);
    assert.equal(op.status, 'completed');
  } finally {
    db.close();
    cleanupTestDatabase(dbPath);
  }
});

// ============================================================
// 测试: committed 恢复
// ============================================================

test('恢复调度: committed 非迁移操作 → applyPendingQuotaEvents 后标记 completed', async () => {
  const { db, dbPath } = createTestDatabase();
  let quotaApplied = false;

  try {
    const manager = createTestManager(db);
    manager.applyPendingQuotaEvents = async () => { quotaApplied = true; };

    const opId = createStorageOperation(db, {
      operationType: 'upload',
      fileId: 'file-cm-1',
      sourceStorageId: 'local-main',
    });
    markOperationCommitted(db, opId, { sourceStorageId: 'local-main' });

    await manager._recoverStaleOperations();

    const op = getOperationStatus(db, opId);
    assert.equal(op.status, 'completed');
    assert.ok(quotaApplied);
  } finally {
    db.close();
    cleanupTestDatabase(dbPath);
  }
});

test('恢复调度: committed 迁移操作 → 清理源端后标记 completed', async () => {
  const { db, dbPath } = createTestDatabase();
  const deletedKeys = [];

  try {
    const mockStorage = {
      delete: async (key) => { deletedKeys.push(key); return true; },
      deleteChunk: async (key) => { deletedKeys.push(key); return true; },
    };
    const manager = createTestManager(db, mockStorage);

    const opId = createStorageOperation(db, {
      operationType: 'migrate',
      fileId: 'file-cm-mig',
      sourceStorageId: 'local-main',
      targetStorageId: 's3-backup',
    });
    markOperationCommitted(db, opId, {
      sourceStorageId: 'local-main',
      targetStorageId: 's3-backup',
      compensationPayload: {
        storageId: 'local-main',
        storageKey: 'old-source-key',
        isChunked: false,
        chunkRecords: [],
      },
    });

    await manager._recoverStaleOperations();

    const op = getOperationStatus(db, opId);
    assert.equal(op.status, 'completed');
    assert.ok(deletedKeys.includes('old-source-key'));
  } finally {
    db.close();
    cleanupTestDatabase(dbPath);
  }
});

// ============================================================
// 测试: 并发安全 (_isRecoveryRunning 互斥)
// ============================================================

test('恢复调度: 并发调用不重入', async () => {
  const { db, dbPath } = createTestDatabase();

  try {
    const manager = createTestManager(db);

    const opId = createStorageOperation(db, {
      operationType: 'upload',
      fileId: 'file-concurrency',
      sourceStorageId: 'local-main',
    });
    markOperationCompensationPending(db, opId, {
      sourceStorageId: 'local-main',
      compensationPayload: {
        storageId: 'local-main',
        storageKey: 'conc-key',
        isChunked: false,
        chunkRecords: [],
      },
      error: new Error('测试'),
    });

    // 模拟第一次恢复正在运行
    manager._isRecoveryRunning = true;

    const result = await manager._recoverStaleOperations();

    assert.equal(result.skipped, true);
    assert.equal(result.recovered, 0);

    // 操作状态应保持不变
    const op = getOperationStatus(db, opId);
    assert.equal(op.status, 'compensation_pending');
  } finally {
    db.close();
    cleanupTestDatabase(dbPath);
  }
});

// ============================================================
// 测试: 恢复失败标记为 failed
// ============================================================

test('恢复调度: 补偿执行失败时标记为 failed', async () => {
  const { db, dbPath } = createTestDatabase();

  try {
    const mockStorage = {
      delete: async () => { throw new Error('存储不可达'); },
      deleteChunk: async () => { throw new Error('存储不可达'); },
    };
    const manager = createTestManager(db, mockStorage);

    const opId = createStorageOperation(db, {
      operationType: 'upload',
      fileId: 'file-fail-1',
      sourceStorageId: 'local-main',
    });
    markOperationCompensationPending(db, opId, {
      sourceStorageId: 'local-main',
      compensationPayload: {
        storageId: 'local-main',
        storageKey: 'fail-key',
        isChunked: false,
        chunkRecords: [],
      },
      error: new Error('原始错误'),
    });

    await manager._recoverStaleOperations();

    const op = getOperationStatus(db, opId);
    assert.equal(op.status, 'failed');
    assert.ok(op.error_message.includes('存储不可达') || op.error_message.includes('删除失败'));
  } finally {
    db.close();
    cleanupTestDatabase(dbPath);
  }
});

// ============================================================
// 测试: 空 payload 的 compensation_pending → 直接标记 compensated
// ============================================================

test('恢复调度: 空 compensation_payload 直接标记 compensated', async () => {
  const { db, dbPath } = createTestDatabase();

  try {
    const manager = createTestManager(db);

    const opId = createStorageOperation(db, {
      operationType: 'delete',
      fileId: 'file-empty-payload',
      sourceStorageId: 'local-main',
    });
    markOperationCompensationPending(db, opId, {
      sourceStorageId: 'local-main',
      compensationPayload: {},
      error: new Error('测试'),
    });

    await manager._recoverStaleOperations();

    const op = getOperationStatus(db, opId);
    assert.equal(op.status, 'compensated');
  } finally {
    db.close();
    cleanupTestDatabase(dbPath);
  }
});

// ============================================================
// 测试: 乐观锁 — 状态已变更时跳过
// ============================================================

test('恢复调度: 乐观锁 — 状态在执行前已变更则跳过', async () => {
  const { db, dbPath } = createTestDatabase();
  let deleteCalled = false;

  try {
    const mockStorage = {
      delete: async () => { deleteCalled = true; return true; },
      deleteChunk: async () => true,
    };
    const manager = createTestManager(db, mockStorage);

    const opId = createStorageOperation(db, {
      operationType: 'upload',
      fileId: 'file-opt-lock',
      sourceStorageId: 'local-main',
    });
    markOperationCompensationPending(db, opId, {
      sourceStorageId: 'local-main',
      compensationPayload: {
        storageId: 'local-main',
        storageKey: 'opt-key',
        isChunked: false,
        chunkRecords: [],
      },
      error: new Error('测试'),
    });

    // 在 _recoverStaleOperations 查询之后、执行之前，模拟状态被外部变更
    // 通过直接修改状态实现：先查询会拿到 compensation_pending，
    // 但重读时已经是 compensated
    markOperationCompensated(db, opId, { compensationPayload: {} });

    const result = await manager._recoverStaleOperations();

    // 查询时已经没有异常操作了（状态已是 compensated）
    assert.equal(result.total, 0);
    assert.equal(deleteCalled, false);
  } finally {
    db.close();
    cleanupTestDatabase(dbPath);
  }
});

// ============================================================
// 测试: 批量上限
// ============================================================

test('恢复调度: 批量上限限制处理数量', async () => {
  const { db, dbPath } = createTestDatabase();

  try {
    const manager = createTestManager(db);

    // 插入 5 条待补偿操作
    for (let i = 0; i < 5; i++) {
      const opId = createStorageOperation(db, {
        operationType: 'upload',
        fileId: `file-batch-${i}`,
        sourceStorageId: 'local-main',
      });
      markOperationCompensationPending(db, opId, {
        sourceStorageId: 'local-main',
        compensationPayload: {},
        error: new Error('测试'),
      });
    }

    // 设置上限为 3
    const result = await manager._recoverStaleOperations({ limit: 3 });

    assert.equal(result.total, 3);
    assert.equal(result.recovered, 3);

    // 验证还有 2 条未处理
    const remaining = db.prepare(
      "SELECT COUNT(*) AS count FROM storage_operations WHERE status = 'compensation_pending'"
    ).get();
    assert.equal(remaining.count, 2);
  } finally {
    db.close();
    cleanupTestDatabase(dbPath);
  }
});

// ============================================================
// 测试: 无异常操作时正常返回
// ============================================================

test('恢复调度: 无异常操作时返回空结果', async () => {
  const { db, dbPath } = createTestDatabase();

  try {
    const manager = createTestManager(db);

    const result = await manager._recoverStaleOperations();

    assert.equal(result.recovered, 0);
    assert.equal(result.total, 0);
    assert.equal(result.skipped, false);
  } finally {
    db.close();
    cleanupTestDatabase(dbPath);
  }
});

// ============================================================
// 测试: 分块文件的 compensation_pending 恢复
// ============================================================

test('恢复调度: 分块文件的补偿操作逐块清理', async () => {
  const { db, dbPath } = createTestDatabase();
  const deletedKeys = [];

  try {
    const mockStorage = {
      delete: async (key) => { deletedKeys.push(key); return true; },
      deleteChunk: async (key) => { deletedKeys.push(key); return true; },
    };
    const manager = createTestManager(db, mockStorage);

    const chunkRecords = [
      { storage_id: 'local-main', storage_key: 'chunk-0' },
      { storage_id: 'local-main', storage_key: 'chunk-1' },
      { storage_id: 'local-main', storage_key: 'chunk-2' },
    ];

    const opId = createStorageOperation(db, {
      operationType: 'upload',
      fileId: 'file-chunked',
      sourceStorageId: 'local-main',
    });
    markOperationCompensationPending(db, opId, {
      sourceStorageId: 'local-main',
      compensationPayload: {
        storageId: 'local-main',
        storageKey: null,
        isChunked: true,
        chunkRecords,
      },
      error: new Error('本地事务失败'),
    });

    await manager._recoverStaleOperations();

    const op = getOperationStatus(db, opId);
    assert.equal(op.status, 'compensated');
    assert.ok(deletedKeys.includes('chunk-0'));
    assert.ok(deletedKeys.includes('chunk-1'));
    assert.ok(deletedKeys.includes('chunk-2'));
  } finally {
    db.close();
    cleanupTestDatabase(dbPath);
  }
});

// ============================================================
// 测试: 多种状态混合恢复
// ============================================================

test('恢复调度: 同时处理多种异常状态', async () => {
  const { db, dbPath } = createTestDatabase();
  const deletedKeys = [];

  try {
    const mockStorage = {
      delete: async (key) => { deletedKeys.push(key); return true; },
      deleteChunk: async (key) => { deletedKeys.push(key); return true; },
    };
    const manager = createTestManager(db, mockStorage);

    // 1. compensation_pending 操作
    const op1 = createStorageOperation(db, {
      operationType: 'upload',
      fileId: 'file-mix-1',
      sourceStorageId: 'local-main',
    });
    markOperationCompensationPending(db, op1, {
      sourceStorageId: 'local-main',
      compensationPayload: {
        storageId: 'local-main',
        storageKey: 'mix-key-1',
        isChunked: false,
        chunkRecords: [],
      },
      error: new Error('测试'),
    });

    // 2. remote_done 上传操作
    const op2 = createStorageOperation(db, {
      operationType: 'upload',
      fileId: 'file-mix-2',
      sourceStorageId: 'local-main',
    });
    markOperationRemoteDone(db, op2, {
      sourceStorageId: 'local-main',
      remotePayload: {
        storageId: 'local-main',
        storageKey: 'mix-key-2',
        isChunked: false,
        chunkRecords: [],
      },
    });

    // 3. committed 操作
    const op3 = createStorageOperation(db, {
      operationType: 'upload',
      fileId: 'file-mix-3',
      sourceStorageId: 'local-main',
    });
    markOperationCommitted(db, op3, { sourceStorageId: 'local-main' });

    const result = await manager._recoverStaleOperations();

    assert.equal(result.total, 3);
    assert.equal(result.recovered, 3);

    const status1 = getOperationStatus(db, op1);
    const status2 = getOperationStatus(db, op2);
    const status3 = getOperationStatus(db, op3);

    assert.equal(status1.status, 'compensated');
    assert.equal(status2.status, 'compensated');
    assert.equal(status3.status, 'completed');

    assert.ok(deletedKeys.includes('mix-key-1'));
    assert.ok(deletedKeys.includes('mix-key-2'));
  } finally {
    db.close();
    cleanupTestDatabase(dbPath);
  }
});

// ============================================================
// 测试: _startCompensationRetryTimer / _stopCompensationRetryTimer
// ============================================================

test('定时器: 启动后可正常停止，不重复创建', () => {
  const { db, dbPath } = createTestDatabase();

  try {
    const manager = createTestManager(db);

    // 启动定时器
    manager._startCompensationRetryTimer();
    assert.ok(manager._compensationRetryTimer !== null);

    const firstTimer = manager._compensationRetryTimer;

    // 重复调用不应创建新定时器
    manager._startCompensationRetryTimer();
    assert.equal(manager._compensationRetryTimer, firstTimer);

    // 停止
    manager._stopCompensationRetryTimer();
    assert.equal(manager._compensationRetryTimer, null);
  } finally {
    db.close();
    cleanupTestDatabase(dbPath);
  }
});

// ============================================================
// 测试: _parseOperationPayload
// ============================================================

test('_parseOperationPayload: 正常 JSON、空值、非法 JSON', () => {
  const { db, dbPath } = createTestDatabase();

  try {
    const manager = createTestManager(db);

    // 正常 JSON
    const result1 = manager._parseOperationPayload('{"storageId":"local-main"}');
    assert.deepEqual(result1, { storageId: 'local-main' });

    // null
    const result2 = manager._parseOperationPayload(null);
    assert.deepEqual(result2, {});

    // undefined
    const result3 = manager._parseOperationPayload(undefined);
    assert.deepEqual(result3, {});

    // 非法 JSON
    const result4 = manager._parseOperationPayload('{bad json}');
    assert.deepEqual(result4, {});
  } finally {
    db.close();
    cleanupTestDatabase(dbPath);
  }
});

// ============================================================
// 测试: _isRecoveryRunning 在异常后被正确重置
// ============================================================

test('恢复调度: 异常后 _isRecoveryRunning 标志被重置', async () => {
  const { db, dbPath } = createTestDatabase();

  try {
    const manager = createTestManager(db);

    // 插入一条异常操作使得查询返回结果
    const opId = createStorageOperation(db, {
      operationType: 'upload',
      fileId: 'file-flag-reset',
      sourceStorageId: 'local-main',
    });
    markOperationCompensationPending(db, opId, {
      sourceStorageId: 'local-main',
      compensationPayload: {
        storageId: 'local-main',
        storageKey: 'flag-key',
        isChunked: false,
        chunkRecords: [],
      },
      error: new Error('测试'),
    });

    // mock 存储抛异常
    manager.instances.set('local-main', {
      instance: {
        delete: async () => { throw new Error('模拟崩溃'); },
        deleteChunk: async () => { throw new Error('模拟崩溃'); },
      },
      type: 'local',
      allowUpload: true,
      weight: 1,
      quotaLimitGB: null,
      disableThresholdPercent: 95,
    });

    await manager._recoverStaleOperations();

    // 即使恢复失败，标志也应被重置
    assert.equal(manager._isRecoveryRunning, false);
  } finally {
    db.close();
    cleanupTestDatabase(dbPath);
  }
});
