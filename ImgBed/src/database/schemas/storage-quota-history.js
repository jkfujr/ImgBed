/**
 * storage_quota_history 表 DDL：容量绝对值快照 + 2 个索引。
 * @param {import('better-sqlite3').Database} db
 */
export function createStorageQuotaHistorySchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS storage_quota_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      storage_id TEXT NOT NULL,
      used_bytes INTEGER NOT NULL,
      recorded_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE INDEX IF NOT EXISTS idx_quota_history_storage_id ON storage_quota_history(storage_id);
    CREATE INDEX IF NOT EXISTS idx_quota_history_recorded_at ON storage_quota_history(recorded_at DESC);
  `);
}
