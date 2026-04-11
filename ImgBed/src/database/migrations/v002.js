import { createLogger } from '../../utils/logger.js';

const log = createLogger('database:migrations:v002');

/**
 * v002 迁移：为 storage_operations 添加 retry_count 列，用于追踪补偿重试次数。
 * @param {import('better-sqlite3').Database} db
 */
export function migrateStorageOperationsRetryCount(db) {
  const cols = db.pragma('table_info(storage_operations)').map(c => c.name);
  if (cols.includes('retry_count')) return;

  db.exec('ALTER TABLE storage_operations ADD COLUMN retry_count INTEGER NOT NULL DEFAULT 0');
  log.info('迁移：storage_operations.retry_count 已添加');
}

/**
 * v002 迁移入口。
 * @param {import('better-sqlite3').Database} db
 */
export function migrateV002(db) {
  migrateStorageOperationsRetryCount(db);
}
