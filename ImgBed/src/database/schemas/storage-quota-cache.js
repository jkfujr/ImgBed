/**
 * storage_quota_cache table DDL.
 * QuotaProjectionService is the only writer for this projection table.
 *
 * @param {import('better-sqlite3').Database} db
 */
export function createStorageQuotaCacheSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS storage_quota_cache (
      storage_id TEXT PRIMARY KEY,
      used_bytes INTEGER NOT NULL DEFAULT 0,
      file_count INTEGER NOT NULL DEFAULT 0,
      last_updated DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CHECK (used_bytes >= 0),
      CHECK (file_count >= 0)
    );

    CREATE INDEX IF NOT EXISTS idx_storage_quota_cache_last_updated
      ON storage_quota_cache(last_updated DESC);
  `);
}
