/**
 * files 表 DDL：CREATE TABLE + 索引 + updated_at 触发器。
 * 注意：quota_cache 的三个跨表触发器在 storage-quota-cache.js 中定义。
 * @param {import('better-sqlite3').Database} db
 */
export function createFilesSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS files (
      id TEXT PRIMARY KEY,
      file_name TEXT NOT NULL,
      original_name TEXT NOT NULL,
      mime_type TEXT,
      size INTEGER NOT NULL,

      -- 存储渠道信息
      storage_channel TEXT NOT NULL,
      storage_key TEXT NOT NULL,
      storage_meta JSON,

      -- 上传信息
      upload_ip TEXT,
      upload_address TEXT,
      uploader_type TEXT,
      uploader_id TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,

      -- 分类和标签
      directory TEXT DEFAULT '/',
      tags JSON,

      -- 访问权限
      is_public BOOLEAN DEFAULT FALSE,

      -- 元数据
      width INTEGER,
      height INTEGER,
      exif JSON,

      -- 存储实例 ID（运行时事实字段，用于路由与容量统计）
      storage_instance_id TEXT,

      is_chunked BOOLEAN DEFAULT FALSE,
      chunk_count INTEGER DEFAULT 0,

      -- 文件状态：active = 正常，channel_deleted = 渠道逻辑删除后冻结
      status TEXT NOT NULL DEFAULT 'active'
    );

    CREATE INDEX IF NOT EXISTS idx_files_created_at ON files(created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_files_storage_channel ON files(storage_channel);
    CREATE INDEX IF NOT EXISTS idx_files_storage_instance ON files(storage_instance_id);
    CREATE INDEX IF NOT EXISTS idx_files_mime_type ON files(mime_type);
    CREATE INDEX IF NOT EXISTS idx_files_is_chunked ON files(is_chunked);
    CREATE INDEX IF NOT EXISTS idx_files_status_created_at ON files(status, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_files_status_directory_created_at ON files(status, directory, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_files_status_storage_instance ON files(status, storage_instance_id);
    CREATE INDEX IF NOT EXISTS idx_files_uploader ON files(uploader_type, uploader_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_files_name_search ON files(file_name COLLATE NOCASE);

    CREATE TRIGGER IF NOT EXISTS update_files_updated_at
      AFTER UPDATE ON files
      BEGIN
        UPDATE files SET updated_at = CURRENT_TIMESTAMP WHERE id = NEW.id;
      END;
  `);
}
