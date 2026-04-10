/**
 * directories 表 DDL：CREATE TABLE + updated_at 触发器。
 * @param {import('better-sqlite3').Database} db
 */
export function createDirectoriesSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS directories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      path TEXT UNIQUE NOT NULL,
      parent_id INTEGER REFERENCES directories(id),
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TRIGGER IF NOT EXISTS update_directories_updated_at
      AFTER UPDATE ON directories
      BEGIN
        UPDATE directories SET updated_at = CURRENT_TIMESTAMP WHERE id = NEW.id;
      END;
  `);
}
