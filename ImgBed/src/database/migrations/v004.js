import { createLogger } from '../../utils/logger.js';

const log = createLogger('database:migrations:v004');

export function dropQuotaCacheTriggers(db) {
  db.exec('DROP TRIGGER IF EXISTS trg_quota_cache_after_insert');
  db.exec('DROP TRIGGER IF EXISTS trg_quota_cache_after_delete');
  db.exec('DROP TRIGGER IF EXISTS trg_quota_cache_after_update');
}

export function migrateV004(db) {
  dropQuotaCacheTriggers(db);
  log.info('迁移：已移除 storage_quota_cache 触发器，quota cache 改由 QuotaProjectionService 单写');
}
