/**
 * system_settings 表 DDL：CREATE TABLE + updated_at 触发器。
 * @param {import('better-sqlite3').Database} db
 */
export function createSystemSettingsSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS system_settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      category TEXT,
      description TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TRIGGER IF NOT EXISTS update_system_settings_updated_at
      AFTER UPDATE ON system_settings
      BEGIN
        UPDATE system_settings SET updated_at = CURRENT_TIMESTAMP WHERE key = NEW.key;
      END;
  `);
}
