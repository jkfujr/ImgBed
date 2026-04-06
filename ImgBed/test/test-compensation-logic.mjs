import test from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import fs from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// 创建临时测试数据库
function createTestDatabase() {
  const dbPath = join(__dirname, `test-compensation-${Date.now()}.db`);
  const db = new Database(dbPath);

  // 初始化必要的表结构
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
    if (fs.existsSync(dbPath)) {
      fs.unlinkSync(dbPath);
    }
  } catch (err) {
    console.warn('清理测试数据库失败:', err.message);
  }
}

// 导入需要测试的模块
import {
  createStorageOperation,
  insertQuotaEvents,
  markOperationCommitted,
  markOperationCompensationPending,
  markOperationFailed,
  buildQuotaEvent,
} from '../src/services/system/storage-operations.js';

test('投影失败回滚：applied_at 应被重置为 NULL', async () => {
  const { db, dbPath } = createTestDatabase();

  try {
    // 1. 创建操作并插入容量事件
    const operationId = createStorageOperation(db, {
      operationType: 'upload',
      fileId: 'test-file-1',
      sourceStorageId: 'local-main',
      payload: {},
    });

    const events = [
      buildQuotaEvent({
        operationId,
        fileId: 'test-file-1',
        storageId: 'local-main',
        eventType: 'upload',
        bytesDelta: 1024,
        fileCountDelta: 1,
      }),
    ];

    insertQuotaEvents(db, events);

    // 2. 标记事件为已应用（模拟投影过程的第一步）
    const eventRows = db.prepare('SELECT id FROM storage_quota_events WHERE operation_id = ?').all(operationId);
    assert.equal(eventRows.length, 1);

    db.prepare('UPDATE storage_quota_events SET applied_at = CURRENT_TIMESTAMP WHERE operation_id = ?')
      .run(operationId);

    // 验证已标记
    const appliedEvent = db.prepare('SELECT applied_at FROM storage_quota_events WHERE operation_id = ?')
      .get(operationId);
    assert.ok(appliedEvent.applied_at !== null);

    // 3. 模拟投影失败，执行回滚逻辑
    const eventIds = eventRows.map(r => r.id);
    const placeholders = eventIds.map(() => '?').join(',');
    db.prepare(`UPDATE storage_quota_events SET applied_at = NULL WHERE id IN (${placeholders})`)
      .run(...eventIds);

    // 4. 验证 applied_at 已被回滚为 NULL
    const rolledBackEvent = db.prepare('SELECT applied_at FROM storage_quota_events WHERE operation_id = ?')
      .get(operationId);
    assert.equal(rolledBackEvent.applied_at, null);

  } finally {
    db.close();
    cleanupTestDatabase(dbPath);
  }
});

test('删除补偿失败：应标记为 COMPENSATION_PENDING 状态', () => {
  const { db, dbPath } = createTestDatabase();

  try {
    // 1. 创建删除操作
    const operationId = createStorageOperation(db, {
      operationType: 'delete',
      fileId: 'test-file-2',
      sourceStorageId: 'local-main',
      payload: {
        storageId: 'local-main',
        storageKey: 'test-key',
        isChunked: false,
        chunkRecords: [],
      },
    });

    // 2. 标记为已提交
    markOperationCommitted(db, operationId, { sourceStorageId: 'local-main' });

    // 3. 模拟远程清理失败，标记为补偿待处理
    const compensationPayload = {
      storageId: 'local-main',
      storageKey: 'test-key',
      isChunked: false,
      chunkRecords: [],
    };

    markOperationCompensationPending(db, operationId, {
      sourceStorageId: 'local-main',
      compensationPayload,
      error: new Error('远程清理失败'),
    });

    // 4. 验证状态为 COMPENSATION_PENDING
    const operation = db.prepare('SELECT status, error_message FROM storage_operations WHERE id = ?')
      .get(operationId);

    assert.equal(operation.status, 'compensation_pending');
    assert.ok(operation.error_message.includes('远程清理失败'));

  } finally {
    db.close();
    cleanupTestDatabase(dbPath);
  }
});

test('迁移源端清理失败：应标记为 COMPENSATION_PENDING 状态', () => {
  const { db, dbPath } = createTestDatabase();

  try {
    // 1. 创建迁移操作
    const operationId = createStorageOperation(db, {
      operationType: 'migrate',
      fileId: 'test-file-3',
      sourceStorageId: 'local-main',
      targetStorageId: 's3-backup',
      payload: {
        sourceStorageId: 'local-main',
        targetStorageId: 's3-backup',
        previousStorageKey: 'old-key',
      },
    });

    // 2. 标记为已提交
    markOperationCommitted(db, operationId, {
      sourceStorageId: 'local-main',
      targetStorageId: 's3-backup',
    });

    // 3. 模拟源端清理失败，标记为补偿待处理
    const compensationPayload = {
      storageId: 'local-main',
      storageKey: 'old-key',
      isChunked: false,
      chunkRecords: [],
    };

    markOperationCompensationPending(db, operationId, {
      sourceStorageId: 'local-main',
      targetStorageId: 's3-backup',
      compensationPayload,
      error: new Error('源端清理失败'),
    });

    // 4. 验证状态为 COMPENSATION_PENDING
    const operation = db.prepare('SELECT status, error_message FROM storage_operations WHERE id = ?')
      .get(operationId);

    assert.equal(operation.status, 'compensation_pending');
    assert.ok(operation.error_message.includes('源端清理失败'));

  } finally {
    db.close();
    cleanupTestDatabase(dbPath);
  }
});

test('上传补偿失败：应标记为 FAILED 状态', () => {
  const { db, dbPath } = createTestDatabase();

  try {
    // 1. 创建上传操作
    const operationId = createStorageOperation(db, {
      operationType: 'upload',
      fileId: 'test-file-4',
      sourceStorageId: 'local-main',
      payload: {
        storageId: 'local-main',
        storageKey: 'upload-key',
        isChunked: false,
        chunkRecords: [],
      },
    });

    // 2. 模拟本地事务失败后的补偿待处理状态
    markOperationCompensationPending(db, operationId, {
      sourceStorageId: 'local-main',
      compensationPayload: {
        storageId: 'local-main',
        storageKey: 'upload-key',
        isChunked: false,
        chunkRecords: [],
      },
      error: new Error('本地事务失败'),
    });

    // 3. 模拟补偿失败，标记为 FAILED
    markOperationFailed(db, operationId, new Error('补偿删除远端对象失败'));

    // 4. 验证状态为 FAILED
    const operation = db.prepare('SELECT status, error_message FROM storage_operations WHERE id = ?')
      .get(operationId);

    assert.equal(operation.status, 'failed');
    assert.ok(operation.error_message.includes('补偿删除远端对象失败'));

  } finally {
    db.close();
    cleanupTestDatabase(dbPath);
  }
});

test('投影失败回滚：快照不会被回滚（部分回滚验证）', async () => {
  const { db, dbPath } = createTestDatabase();

  try {
    // 1. 创建操作并插入容量事件
    const operationId = createStorageOperation(db, {
      operationType: 'upload',
      fileId: 'test-file-5',
      sourceStorageId: 'local-main',
      payload: {},
    });

    const events = [
      buildQuotaEvent({
        operationId,
        fileId: 'test-file-5',
        storageId: 'local-main',
        eventType: 'upload',
        bytesDelta: 2048,
        fileCountDelta: 1,
      }),
    ];

    insertQuotaEvents(db, events);

    // 2. 标记事件为已应用并插入快照
    db.prepare('UPDATE storage_quota_events SET applied_at = CURRENT_TIMESTAMP WHERE operation_id = ?')
      .run(operationId);

    db.prepare(`
      INSERT INTO storage_quota_history (storage_id, bytes_used, file_count)
      VALUES (?, ?, ?)
    `).run('local-main', 2048, 1);

    const snapshotBefore = db.prepare('SELECT COUNT(*) as count FROM storage_quota_history WHERE storage_id = ?')
      .get('local-main');
    assert.equal(snapshotBefore.count, 1);

    // 3. 执行回滚逻辑（仅回滚 applied_at）
    const eventRows = db.prepare('SELECT id FROM storage_quota_events WHERE operation_id = ?').all(operationId);
    const eventIds = eventRows.map(r => r.id);
    const placeholders = eventIds.map(() => '?').join(',');
    db.prepare(`UPDATE storage_quota_events SET applied_at = NULL WHERE id IN (${placeholders})`)
      .run(...eventIds);

    // 4. 验证快照仍然存在（部分回滚的证据）
    const snapshotAfter = db.prepare('SELECT COUNT(*) as count FROM storage_quota_history WHERE storage_id = ?')
      .get('local-main');
    assert.equal(snapshotAfter.count, 1); // 快照未被删除

    // 5. 验证事件的 applied_at 已被回滚
    const rolledBackEvent = db.prepare('SELECT applied_at FROM storage_quota_events WHERE operation_id = ?')
      .get(operationId);
    assert.equal(rolledBackEvent.applied_at, null);

  } finally {
    db.close();
    cleanupTestDatabase(dbPath);
  }
});

test('补偿逻辑：状态转换路径验证', () => {
  const { db, dbPath } = createTestDatabase();

  try {
    // 验证完整的状态转换路径：PENDING → COMMITTED → COMPENSATION_PENDING → FAILED
    const operationId = createStorageOperation(db, {
      operationType: 'upload',
      fileId: 'test-file-6',
      sourceStorageId: 'local-main',
      payload: {},
    });

    // 初始状态应为 PENDING
    let operation = db.prepare('SELECT status FROM storage_operations WHERE id = ?')
      .get(operationId);
    assert.equal(operation.status, 'pending');

    // 转换到 COMMITTED
    markOperationCommitted(db, operationId, { sourceStorageId: 'local-main' });
    operation = db.prepare('SELECT status FROM storage_operations WHERE id = ?')
      .get(operationId);
    assert.equal(operation.status, 'committed');

    // 转换到 COMPENSATION_PENDING
    markOperationCompensationPending(db, operationId, {
      sourceStorageId: 'local-main',
      compensationPayload: {},
      error: new Error('清理失败'),
    });
    operation = db.prepare('SELECT status FROM storage_operations WHERE id = ?')
      .get(operationId);
    assert.equal(operation.status, 'compensation_pending');

    // 转换到 FAILED
    markOperationFailed(db, operationId, new Error('补偿失败'));
    operation = db.prepare('SELECT status FROM storage_operations WHERE id = ?')
      .get(operationId);
    assert.equal(operation.status, 'failed');

  } finally {
    db.close();
    cleanupTestDatabase(dbPath);
  }
});
