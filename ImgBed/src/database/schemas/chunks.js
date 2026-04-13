/**
 * chunks 分片表 DDL：CREATE TABLE + 2 个索引 + updated_at 触发器。
 * file_id 外键引用 files(id)，files 表必须先于此表创建。
 * @param {import('better-sqlite3').Database} db
 */
export function createChunksSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS chunks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      file_id TEXT NOT NULL REFERENCES files(id),
      chunk_index INTEGER NOT NULL,
      storage_type TEXT NOT NULL,
      storage_id TEXT NOT NULL,
      storage_key TEXT NOT NULL,
      storage_meta JSON,
      size INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE INDEX IF NOT EXISTS idx_chunks_file_id ON chunks(file_id);
    CREATE INDEX IF NOT EXISTS idx_chunks_storage_id ON chunks(storage_id);

    CREATE TRIGGER IF NOT EXISTS update_chunks_updated_at
      AFTER UPDATE ON chunks
      BEGIN
        UPDATE chunks SET updated_at = CURRENT_TIMESTAMP WHERE id = NEW.id;
      END;
  `);
}
