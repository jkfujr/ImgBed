import { fileURLToPath } from 'url';
import path from 'path';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const Database = require('better-sqlite3');
const { join } = path;

console.log('=== 事件表归档功能测试 ===\n');

let passed = true;

/**
 * 创建测试数据库
 */
function createTestDatabase() {
  const dbPath = join(__dirname, `test-archive-${Date.now()}.db`);
  const db = new Database(dbPath);

  db.exec(`
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

    CREATE TABLE IF NOT EXISTS storage_quota_events_archive (
      id INTEGER PRIMARY KEY,
      operation_id TEXT NOT NULL,
      file_id TEXT,
      storage_id TEXT NOT NULL,
      event_type TEXT NOT NULL,
      bytes_delta INTEGER NOT NULL,
      file_count_delta INTEGER NOT NULL DEFAULT 0,
      idempotency_key TEXT NOT NULL,
      payload TEXT,
      applied_at TEXT NOT NULL,
      created_at TEXT NOT NULL,
      archived_at TEXT DEFAULT CURRENT_TIMESTAMP
    );
  `);

  return { db, dbPath };
}

/**
 * 清理测试数据库
 */
function cleanupTestDatabase(dbPath) {
  try {
    const fs = require('fs');
    if (fs.existsSync(dbPath)) {
      fs.unlinkSync(dbPath);
    }
  } catch (err) {
    console.error('清理测试数据库失败:', err);
  }
}

/**
 * 插入测试事件
 */
function insertTestEvents(db, events) {
  const stmt = db.prepare(`
    INSERT INTO storage_quota_events (
      operation_id, file_id, storage_id, event_type,
      bytes_delta, file_count_delta, idempotency_key,
      payload, applied_at, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  for (const event of events) {
    stmt.run(
      event.operation_id,
      event.file_id || null,
      event.storage_id,
      event.event_type,
      event.bytes_delta,
      event.file_count_delta || 0,
      event.idempotency_key,
      event.payload || null,
      event.applied_at || null,
      event.created_at
    );
  }
}

/**
 * 执行归档批次（模拟归档服务逻辑）
 */
function archiveBatch(db, cutoffTimestamp, batchSize) {
  return db.transaction(() => {
    // 1. 选择满足条件的历史事件
    const candidates = db.prepare(`
      SELECT
        id, operation_id, file_id, storage_id, event_type,
        bytes_delta, file_count_delta, idempotency_key, payload,
        applied_at, created_at
      FROM storage_quota_events
      WHERE applied_at IS NOT NULL
        AND applied_at < ?
      ORDER BY applied_at ASC
      LIMIT ?
    `).all(cutoffTimestamp, batchSize);

    if (candidates.length === 0) {
      return { archived: 0, deleted: 0 };
    }

    // 2. 插入归档表
    const insertStmt = db.prepare(`
      INSERT INTO storage_quota_events_archive (
        id, operation_id, file_id, storage_id, event_type,
        bytes_delta, file_count_delta, idempotency_key, payload,
        applied_at, created_at, archived_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    `);

    for (const event of candidates) {
      insertStmt.run(
        event.id,
        event.operation_id,
        event.file_id,
        event.storage_id,
        event.event_type,
        event.bytes_delta,
        event.file_count_delta,
        event.idempotency_key,
        event.payload,
        event.applied_at,
        event.created_at
      );
    }

    // 3. 校验归档数量
    const archivedCount = db.prepare(`
      SELECT COUNT(*) as count
      FROM storage_quota_events_archive
      WHERE id IN (${candidates.map(() => '?').join(',')})
    `).get(...candidates.map(e => e.id)).count;

    if (archivedCount !== candidates.length) {
      throw new Error(`归档数量不匹配: 预期 ${candidates.length}, 实际 ${archivedCount}`);
    }

    // 4. 从活跃表删除
    const deleteStmt = db.prepare(`
      DELETE FROM storage_quota_events
      WHERE id IN (${candidates.map(() => '?').join(',')})
    `);

    const deleteResult = deleteStmt.run(...candidates.map(e => e.id));

    return {
      archived: archivedCount,
      deleted: deleteResult.changes
    };
  })();
}

try {
  // 1. 测试归档已应用事件
  console.log('1. 测试归档已应用事件...');
  {
    const { db, dbPath } = createTestDatabase();

    try {
      // 插入测试数据：3个已应用事件（30天前）+ 2个已应用事件（最近）+ 1个未应用事件
      const oldDate = new Date();
      oldDate.setDate(oldDate.getDate() - 31);
      const oldTimestamp = oldDate.toISOString();

      const recentDate = new Date();
      recentDate.setDate(recentDate.getDate() - 1);
      const recentTimestamp = recentDate.toISOString();

      insertTestEvents(db, [
        {
          operation_id: 'op-old-1',
          storage_id: 'local-1',
          event_type: 'upload',
          bytes_delta: 1024,
          file_count_delta: 1,
          idempotency_key: 'key-old-1',
          applied_at: oldTimestamp,
          created_at: oldTimestamp
        },
        {
          operation_id: 'op-old-2',
          storage_id: 'local-1',
          event_type: 'upload',
          bytes_delta: 2048,
          file_count_delta: 1,
          idempotency_key: 'key-old-2',
          applied_at: oldTimestamp,
          created_at: oldTimestamp
        },
        {
          operation_id: 'op-old-3',
          storage_id: 'local-1',
          event_type: 'delete',
          bytes_delta: -1024,
          file_count_delta: -1,
          idempotency_key: 'key-old-3',
          applied_at: oldTimestamp,
          created_at: oldTimestamp
        },
        {
          operation_id: 'op-recent-1',
          storage_id: 'local-1',
          event_type: 'upload',
          bytes_delta: 512,
          file_count_delta: 1,
          idempotency_key: 'key-recent-1',
          applied_at: recentTimestamp,
          created_at: recentTimestamp
        },
        {
          operation_id: 'op-recent-2',
          storage_id: 'local-1',
          event_type: 'upload',
          bytes_delta: 256,
          file_count_delta: 1,
          idempotency_key: 'key-recent-2',
          applied_at: recentTimestamp,
          created_at: recentTimestamp
        },
        {
          operation_id: 'op-pending',
          storage_id: 'local-1',
          event_type: 'upload',
          bytes_delta: 128,
          file_count_delta: 1,
          idempotency_key: 'key-pending',
          applied_at: null,
          created_at: recentTimestamp
        }
      ]);

      // 执行归档（保留期30天）
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - 30);
      const cutoffTimestamp = cutoffDate.toISOString();

      const result = archiveBatch(db, cutoffTimestamp, 500);

      if (result.archived === 3 && result.deleted === 3) {
        console.log('   ✓ 归档了3个超过保留期的已应用事件');
      } else {
        console.log(`   ✗ 归档数量错误: archived=${result.archived}, deleted=${result.deleted}`);
        passed = false;
      }

      // 验证活跃表剩余3个事件（2个最近的 + 1个未应用）
      const activeCount = db.prepare('SELECT COUNT(*) as count FROM storage_quota_events').get().count;
      if (activeCount === 3) {
        console.log('   ✓ 活跃表保留了3个事件');
      } else {
        console.log(`   ✗ 活跃表事件数量错误: ${activeCount}`);
        passed = false;
      }

      // 验证归档表有3个事件
      const archiveCount = db.prepare('SELECT COUNT(*) as count FROM storage_quota_events_archive').get().count;
      if (archiveCount === 3) {
        console.log('   ✓ 归档表包含3个事件');
      } else {
        console.log(`   ✗ 归档表事件数量错误: ${archiveCount}`);
        passed = false;
      }

      // 验证未应用事件未被归档
      const pendingEvent = db.prepare('SELECT * FROM storage_quota_events WHERE operation_id = ?').get('op-pending');
      if (pendingEvent && pendingEvent.applied_at === null) {
        console.log('   ✓ 未应用事件未被归档');
      } else {
        console.log('   ✗ 未应用事件应该保留在活跃表');
        passed = false;
      }

    } finally {
      db.close();
      cleanupTestDatabase(dbPath);
    }
  }

  // 2. 测试归档表字段完整性
  console.log('\n2. 测试归档表字段完整性...');
  {
    const { db, dbPath } = createTestDatabase();

    try {
      const oldDate = new Date();
      oldDate.setDate(oldDate.getDate() - 31);
      const oldTimestamp = oldDate.toISOString();

      insertTestEvents(db, [
        {
          operation_id: 'op-test',
          file_id: 'file-123',
          storage_id: 'local-1',
          event_type: 'upload',
          bytes_delta: 1024,
          file_count_delta: 1,
          idempotency_key: 'key-test',
          payload: JSON.stringify({ test: 'data' }),
          applied_at: oldTimestamp,
          created_at: oldTimestamp
        }
      ]);

      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - 30);
      archiveBatch(db, cutoffDate.toISOString(), 500);

      const archivedEvent = db.prepare('SELECT * FROM storage_quota_events_archive WHERE operation_id = ?').get('op-test');

      if (archivedEvent &&
          archivedEvent.operation_id === 'op-test' &&
          archivedEvent.file_id === 'file-123' &&
          archivedEvent.storage_id === 'local-1' &&
          archivedEvent.event_type === 'upload' &&
          archivedEvent.bytes_delta === 1024 &&
          archivedEvent.file_count_delta === 1 &&
          archivedEvent.idempotency_key === 'key-test' &&
          archivedEvent.applied_at !== null &&
          archivedEvent.created_at !== null &&
          archivedEvent.archived_at !== null) {
        console.log('   ✓ 归档表保留了所有关键字段');
      } else {
        console.log('   ✗ 归档表字段不完整');
        passed = false;
      }

    } finally {
      db.close();
      cleanupTestDatabase(dbPath);
    }
  }

  // 3. 测试批量归档
  console.log('\n3. 测试批量归档...');
  {
    const { db, dbPath } = createTestDatabase();

    try {
      const oldDate = new Date();
      oldDate.setDate(oldDate.getDate() - 31);
      const oldTimestamp = oldDate.toISOString();

      // 插入10个旧事件
      const events = [];
      for (let i = 0; i < 10; i++) {
        events.push({
          operation_id: `op-batch-${i}`,
          storage_id: 'local-1',
          event_type: 'upload',
          bytes_delta: 100 * i,
          file_count_delta: 1,
          idempotency_key: `key-batch-${i}`,
          applied_at: oldTimestamp,
          created_at: oldTimestamp
        });
      }
      insertTestEvents(db, events);

      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - 30);

      // 第一批：归档5个
      const result1 = archiveBatch(db, cutoffDate.toISOString(), 5);
      if (result1.archived === 5) {
        console.log('   ✓ 第一批归档了5个事件');
      } else {
        console.log(`   ✗ 第一批归档数量错误: ${result1.archived}`);
        passed = false;
      }

      // 第二批：归档剩余5个
      const result2 = archiveBatch(db, cutoffDate.toISOString(), 5);
      if (result2.archived === 5) {
        console.log('   ✓ 第二批归档了5个事件');
      } else {
        console.log(`   ✗ 第二批归档数量错误: ${result2.archived}`);
        passed = false;
      }

      // 第三批：没有更多事件
      const result3 = archiveBatch(db, cutoffDate.toISOString(), 5);
      if (result3.archived === 0) {
        console.log('   ✓ 第三批没有更多事件可归档');
      } else {
        console.log(`   ✗ 第三批应该没有事件: ${result3.archived}`);
        passed = false;
      }

      const archiveCount = db.prepare('SELECT COUNT(*) as count FROM storage_quota_events_archive').get().count;
      if (archiveCount === 10) {
        console.log('   ✓ 总共归档了10个事件');
      } else {
        console.log(`   ✗ 归档总数错误: ${archiveCount}`);
        passed = false;
      }

    } finally {
      db.close();
      cleanupTestDatabase(dbPath);
    }
  }

  // 4. 测试事务一致性
  console.log('\n4. 测试事务一致性...');
  {
    const { db, dbPath } = createTestDatabase();

    try {
      const oldDate = new Date();
      oldDate.setDate(oldDate.getDate() - 31);
      const oldTimestamp = oldDate.toISOString();

      insertTestEvents(db, [
        {
          operation_id: 'op-tx-1',
          storage_id: 'local-1',
          event_type: 'upload',
          bytes_delta: 1024,
          file_count_delta: 1,
          idempotency_key: 'key-tx-1',
          applied_at: oldTimestamp,
          created_at: oldTimestamp
        }
      ]);

      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - 30);
      archiveBatch(db, cutoffDate.toISOString(), 500);

      // 验证活跃表已删除
      const activeEvent = db.prepare('SELECT * FROM storage_quota_events WHERE operation_id = ?').get('op-tx-1');
      if (!activeEvent) {
        console.log('   ✓ 活跃表事件已删除');
      } else {
        console.log('   ✗ 活跃表事件应该被删除');
        passed = false;
      }

      // 验证归档表已插入
      const archivedEvent = db.prepare('SELECT * FROM storage_quota_events_archive WHERE operation_id = ?').get('op-tx-1');
      if (archivedEvent) {
        console.log('   ✓ 归档表事件已插入');
      } else {
        console.log('   ✗ 归档表事件应该被插入');
        passed = false;
      }

    } finally {
      db.close();
      cleanupTestDatabase(dbPath);
    }
  }

} catch (err) {
  console.error('\n✗ 测试过程中发生错误:', err);
  passed = false;
}

console.log('\n=== 测试结果 ===');
if (passed) {
  console.log('✓ 所有测试通过');
  process.exit(0);
} else {
  console.log('✗ 部分测试失败');
  process.exit(1);
}
