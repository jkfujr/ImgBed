import { createLogger } from '../utils/logger.js';
import { hasColumn, hasTable } from './schema-utils.js';

const log = createLogger('database:migrate');

export const SCHEMA_VERSION = 2;

function assertTableExists(db, tableName) {
  if (!hasTable(db, tableName)) {
    throw new Error(`数据库缺少 v2 必需数据表 ${tableName}，请删除旧数据库后重建`);
  }
}

function assertTableMissing(db, tableName) {
  if (hasTable(db, tableName)) {
    throw new Error(`数据库仍包含已废弃数据表 ${tableName}，请删除旧数据库后重建`);
  }
}

function assertSchemaColumn(db, tableName, columnName) {
  if (!hasColumn(db, tableName, columnName)) {
    throw new Error(`数据库缺少 v2 必需字段 ${tableName}.${columnName}，请删除旧数据库后重建`);
  }
}

function assertSchemaColumnMissing(db, tableName, columnName) {
  if (hasColumn(db, tableName, columnName)) {
    throw new Error(`数据库仍包含已废弃字段 ${tableName}.${columnName}，请删除旧数据库后重建`);
  }
}

function validateSchemaV2(db) {
  assertTableExists(db, 'files');
  assertTableExists(db, 'chunks');
  assertTableExists(db, 'storage_operations');
  assertSchemaColumn(db, 'storage_operations', 'retry_count');
  assertSchemaColumn(db, 'storage_operations', 'source_storage_id');
  assertSchemaColumn(db, 'storage_operations', 'target_storage_id');
  assertSchemaColumn(db, 'storage_operations', 'remote_payload');
  assertSchemaColumn(db, 'storage_operations', 'compensation_payload');
  assertSchemaColumn(db, 'files', 'storage_meta');
  assertSchemaColumn(db, 'files', 'storage_instance_id');
  assertSchemaColumn(db, 'files', 'status');
  assertSchemaColumn(db, 'chunks', 'storage_meta');
  assertSchemaColumnMissing(db, 'files', 'storage_config');
  assertSchemaColumnMissing(db, 'chunks', 'storage_config');
  assertTableMissing(db, 'system_settings');
  assertTableMissing(db, 'storage_channels');
}

export function runMigrations(db) {
  try {
    db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      applied_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);

    validateSchemaV2(db);
    db.prepare('DELETE FROM schema_migrations WHERE version != ?').run(SCHEMA_VERSION);
    db.prepare('INSERT OR IGNORE INTO schema_migrations (version) VALUES (?)').run(SCHEMA_VERSION);

    log.info({ version: SCHEMA_VERSION }, '数据库结构已登记为 v2');
  } catch (err) {
    log.error({ err }, '数据库结构版本登记失败');
    throw err;
  }
}
