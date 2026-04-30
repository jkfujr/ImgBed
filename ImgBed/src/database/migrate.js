import { createLogger } from '../utils/logger.js';
import { hasColumn, hasTable } from './schema-utils.js';

const log = createLogger('database:migrate');

export const SCHEMA_VERSION = 4;

function versionLabel() {
  return `v${SCHEMA_VERSION}`;
}

function assertTableExists(db, tableName) {
  if (!hasTable(db, tableName)) {
    throw new Error(`数据库缺少 ${versionLabel()} 必需数据表 ${tableName}，请删除旧数据库后重建`);
  }
}

function assertTableMissing(db, tableName) {
  if (hasTable(db, tableName)) {
    throw new Error(`数据库仍包含已废弃数据表 ${tableName}，请删除旧数据库后重建`);
  }
}

function assertSchemaColumn(db, tableName, columnName) {
  if (!hasColumn(db, tableName, columnName)) {
    throw new Error(`数据库缺少 ${versionLabel()} 必需字段 ${tableName}.${columnName}，请删除旧数据库后重建`);
  }
}

function assertSchemaColumnMissing(db, tableName, columnName) {
  if (hasColumn(db, tableName, columnName)) {
    throw new Error(`数据库仍包含已废弃字段 ${tableName}.${columnName}，请删除旧数据库后重建`);
  }
}

function migrateTaskLogTriggerType(db) {
  if (hasTable(db, 'task_logs') && !hasColumn(db, 'task_logs', 'trigger_type')) {
    db.prepare("ALTER TABLE task_logs ADD COLUMN trigger_type TEXT NOT NULL DEFAULT 'manual'").run();
    log.info('已为 task_logs 自动补充 trigger_type 字段');
  }
}

function validateSchema(db) {
  assertTableExists(db, 'files');
  assertTableExists(db, 'chunks');
  assertTableExists(db, 'storage_operations');
  assertTableExists(db, 'task_logs');
  assertTableExists(db, 'task_log_items');
  assertSchemaColumn(db, 'task_logs', 'task_type');
  assertSchemaColumn(db, 'task_logs', 'trigger_type');
  assertSchemaColumn(db, 'task_logs', 'source_storage_id');
  assertSchemaColumn(db, 'task_logs', 'target_storage_id');
  assertSchemaColumn(db, 'task_logs', 'error_summary');
  assertSchemaColumn(db, 'task_log_items', 'attempt_count');
  assertSchemaColumn(db, 'task_log_items', 'last_error');
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

function cleanupRemovedStorageTypes(db) {
  const res = db.prepare("DELETE FROM files WHERE storage_channel = 'external'").run();
  if (res.changes > 0) {
    log.warn({ removed: res.changes }, '已清理不再支持的 external 存储类型文件记录');
  }
}

function cleanupAccessLogAdminFlag(db) {
  const res = db.prepare('UPDATE access_logs SET is_admin = 0 WHERE is_admin IS NULL').run();
  if (res.changes > 0) {
    log.info({ updated: res.changes }, '已清理访问日志中的历史空管理员标记');
  }
}

export function runMigrations(db) {
  try {
    db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      applied_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);

    migrateTaskLogTriggerType(db);
    validateSchema(db);
    cleanupRemovedStorageTypes(db);
    cleanupAccessLogAdminFlag(db);
    db.prepare('DELETE FROM schema_migrations WHERE version != ?').run(SCHEMA_VERSION);
    db.prepare('INSERT OR IGNORE INTO schema_migrations (version) VALUES (?)').run(SCHEMA_VERSION);

    log.info({ version: SCHEMA_VERSION }, `数据库结构已登记为 ${versionLabel()}`);
  } catch (err) {
    log.error({ err }, '数据库结构版本登记失败');
    throw err;
  }
}
