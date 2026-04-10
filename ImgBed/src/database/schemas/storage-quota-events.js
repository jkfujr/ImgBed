/**
 * storage_quota_events 表 DDL：幂等容量变更账本 + 4 个索引。
 * @param {import('better-sqlite3').Database} db
 */
export function createStorageQuotaEventsSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS storage_quota_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      operation_id TEXT NOT NULL,
      file_id TEXT,
      storage_id TEXT NOT NULL,
      event_type TEXT NOT NULL,
      bytes_delta INTEGER NOT NULL,
      file_count_delta INTEGER NOT NULL DEFAULT 0,
      idempotency_key TEXT NOT NULL UNIQUE,
      payload JSON,
      applied_at DATETIME,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE INDEX IF NOT EXISTS idx_quota_events_operation_id ON storage_quota_events(operation_id);
    CREATE INDEX IF NOT EXISTS idx_quota_events_storage_id ON storage_quota_events(storage_id);
    CREATE INDEX IF NOT EXISTS idx_quota_events_applied_at ON storage_quota_events(applied_at);
    CREATE INDEX IF NOT EXISTS idx_quota_events_created_at ON storage_quota_events(created_at DESC);
  `);
}
