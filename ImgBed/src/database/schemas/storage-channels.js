/**
 * storage_channels 表 DDL：CREATE TABLE + updated_at 触发器。
 * @param {import('better-sqlite3').Database} db
 */
export function createStorageChannelsSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS storage_channels (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      type TEXT NOT NULL,
      enabled BOOLEAN DEFAULT TRUE,
      allow_upload BOOLEAN DEFAULT TRUE,
      weight INTEGER DEFAULT 1,
      quota_limit_gb REAL,
      deleted_at DATETIME,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TRIGGER IF NOT EXISTS update_storage_channels_updated_at
      AFTER UPDATE ON storage_channels
      BEGIN
        UPDATE storage_channels SET updated_at = CURRENT_TIMESTAMP WHERE id = NEW.id;
      END;
  `);
}
