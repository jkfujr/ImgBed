/**
 * storage_operations 表 DDL：Saga 补偿跟踪 + 3 个索引 + updated_at 触发器。
 * @param {import('better-sqlite3').Database} db
 */
export function createStorageOperationsSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS storage_operations (
      id TEXT PRIMARY KEY,
      operation_type TEXT NOT NULL,
      file_id TEXT,
      status TEXT NOT NULL,
      source_storage_id TEXT,
      target_storage_id TEXT,
      remote_payload JSON,
      compensation_payload JSON,
      error_message TEXT,
      retry_count INTEGER NOT NULL DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE INDEX IF NOT EXISTS idx_storage_operations_status ON storage_operations(status);
    CREATE INDEX IF NOT EXISTS idx_storage_operations_file_id ON storage_operations(file_id);
    CREATE INDEX IF NOT EXISTS idx_storage_operations_created_at ON storage_operations(created_at DESC);

    CREATE TRIGGER IF NOT EXISTS update_storage_operations_updated_at
      AFTER UPDATE ON storage_operations
      BEGIN
        UPDATE storage_operations SET updated_at = CURRENT_TIMESTAMP WHERE id = NEW.id;
      END;
  `);
}

