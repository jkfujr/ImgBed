import { createLogger } from '../utils/logger.js';

const log = createLogger('database:migrate');

export const SCHEMA_VERSION = 0;

export function runMigrations(db) {
  try {
    db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      applied_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);

    db.prepare('DELETE FROM schema_migrations WHERE version != ?').run(SCHEMA_VERSION);
    db.prepare('INSERT OR IGNORE INTO schema_migrations (version) VALUES (?)').run(SCHEMA_VERSION);

    log.info({ version: SCHEMA_VERSION }, '数据库结构已登记为 v0');
  } catch (err) {
    log.error({ err }, '数据库结构版本登记失败');
    throw err;
  }
}
