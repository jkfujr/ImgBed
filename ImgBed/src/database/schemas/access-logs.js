/**
 * access_logs 表 DDL：文件访问日志 + 4 个索引。
 * file_id 外键引用 files(id) ON DELETE CASCADE，需启用 PRAGMA foreign_keys = ON 才生效。
 * files 表必须先于此表创建。
 * @param {import('better-sqlite3').Database} db
 */
export function createAccessLogsSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS access_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      file_id TEXT NOT NULL,
      ip TEXT NOT NULL,
      user_agent TEXT,
      referer TEXT,
      is_admin BOOLEAN DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (file_id) REFERENCES files(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_access_logs_file_id ON access_logs(file_id);
    CREATE INDEX IF NOT EXISTS idx_access_logs_created_at ON access_logs(created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_access_logs_ip ON access_logs(ip);
    CREATE INDEX IF NOT EXISTS idx_access_logs_is_admin ON access_logs(is_admin);
    CREATE INDEX IF NOT EXISTS idx_access_logs_is_admin_created_at ON access_logs(is_admin, created_at DESC);
  `);
}
