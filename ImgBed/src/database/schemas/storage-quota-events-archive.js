/**
 * storage_quota_events_archive 表 DDL：已归档容量事件 + 4 个索引。
 * @param {import('better-sqlite3').Database} db
 */
export function createStorageQuotaEventsArchiveSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS storage_quota_events_archive (
      id INTEGER PRIMARY KEY,
      operation_id TEXT NOT NULL,
      file_id TEXT,
      storage_id TEXT NOT NULL,
      event_type TEXT NOT NULL,
      bytes_delta INTEGER NOT NULL,
      file_count_delta INTEGER NOT NULL DEFAULT 0,
      idempotency_key TEXT NOT NULL,
      payload JSON,
      applied_at DATETIME NOT NULL,
      created_at DATETIME NOT NULL,
      archived_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE INDEX IF NOT EXISTS idx_quota_events_archive_operation_id ON storage_quota_events_archive(operation_id);
    CREATE INDEX IF NOT EXISTS idx_quota_events_archive_storage_id ON storage_quota_events_archive(storage_id);
    CREATE INDEX IF NOT EXISTS idx_quota_events_archive_archived_at ON storage_quota_events_archive(archived_at DESC);
    CREATE INDEX IF NOT EXISTS idx_quota_events_archive_created_at ON storage_quota_events_archive(created_at DESC);
  `);
}
