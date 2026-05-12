/**
 * task_logs / task_log_items：后台任务日志与逐项执行记录。
 * @param {import('better-sqlite3').Database} db
 */
export function createTaskLogsSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS task_logs (
      id TEXT PRIMARY KEY,
      task_type TEXT NOT NULL,
      trigger_type TEXT NOT NULL DEFAULT 'manual',
      status TEXT NOT NULL,
      source_storage_id TEXT,
      target_storage_id TEXT,
      total_count INTEGER NOT NULL DEFAULT 0,
      success_count INTEGER NOT NULL DEFAULT 0,
      failed_count INTEGER NOT NULL DEFAULT 0,
      skipped_count INTEGER NOT NULL DEFAULT 0,
      error_summary TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      started_at DATETIME,
      ended_at DATETIME,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE INDEX IF NOT EXISTS idx_task_logs_status ON task_logs(status);
    CREATE INDEX IF NOT EXISTS idx_task_logs_type_created ON task_logs(task_type, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_task_logs_created_at ON task_logs(created_at DESC);

    CREATE TABLE IF NOT EXISTS task_log_items (
      id TEXT PRIMARY KEY,
      task_id TEXT NOT NULL,
      file_id TEXT,
      status TEXT NOT NULL,
      attempt_count INTEGER NOT NULL DEFAULT 0,
      last_error TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (task_id) REFERENCES task_logs(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_task_log_items_task_id ON task_log_items(task_id);
    CREATE INDEX IF NOT EXISTS idx_task_log_items_status ON task_log_items(status);
    CREATE INDEX IF NOT EXISTS idx_task_log_items_file_id ON task_log_items(file_id);

    CREATE INDEX IF NOT EXISTS idx_task_logs_status_type_created ON task_logs(status, task_type, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_task_log_items_task_status_created ON task_log_items(task_id, status, created_at ASC);

    CREATE TRIGGER IF NOT EXISTS update_task_logs_updated_at
      AFTER UPDATE ON task_logs
      BEGIN
        UPDATE task_logs SET updated_at = CURRENT_TIMESTAMP WHERE id = NEW.id;
      END;

    CREATE TRIGGER IF NOT EXISTS update_task_log_items_updated_at
      AFTER UPDATE ON task_log_items
      BEGIN
        UPDATE task_log_items SET updated_at = CURRENT_TIMESTAMP WHERE id = NEW.id;
      END;
  `);
}
