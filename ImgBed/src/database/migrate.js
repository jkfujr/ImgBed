import { createLogger } from '../utils/logger.js';
import { hasColumn } from './schema-utils.js';

const log = createLogger('database:migrate');

export const SCHEMA_VERSION = 1;

function assertSchemaColumn(db, tableName, columnName) {
  if (!hasColumn(db, tableName, columnName)) {
    throw new Error(`数据库缺少 v1 必需字段 ${tableName}.${columnName}，请删除旧数据库后重建`);
  }
}

function assertSchemaColumnMissing(db, tableName, columnName) {
  if (hasColumn(db, tableName, columnName)) {
    throw new Error(`数据库仍包含已废弃字段 ${tableName}.${columnName}，请删除旧数据库后重建`);
  }
}

function validateSchemaV1(db) {
  assertSchemaColumn(db, 'storage_operations', 'retry_count');
  assertSchemaColumn(db, 'storage_channels', 'deleted_at');
  assertSchemaColumn(db, 'files', 'storage_meta');
  assertSchemaColumn(db, 'chunks', 'storage_meta');
  assertSchemaColumnMissing(db, 'files', 'storage_config');
  assertSchemaColumnMissing(db, 'chunks', 'storage_config');
}

export function runMigrations(db) {
  try {
    db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      applied_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);

    validateSchemaV1(db);
    db.prepare('DELETE FROM schema_migrations WHERE version != ?').run(SCHEMA_VERSION);
    db.prepare('INSERT OR IGNORE INTO schema_migrations (version) VALUES (?)').run(SCHEMA_VERSION);

    log.info({ version: SCHEMA_VERSION }, '数据库结构已登记为 v1');
  } catch (err) {
    log.error({ err }, '数据库结构版本登记失败');
    throw err;
  }
}
