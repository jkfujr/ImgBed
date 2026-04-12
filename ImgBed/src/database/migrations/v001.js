import { createLogger } from '../../utils/logger.js';

const log = createLogger('database:migrations:v001');

/**
 * v001 迁移：为 storage_channels 添加 deleted_at 列（逻辑删除时间戳）。
 * @param {import('better-sqlite3').Database} db
 */
export function migrateStorageChannelsDeletedAt(db) {
  const cols = db.pragma('table_info(storage_channels)').map(c => c.name);
  if (cols.includes('deleted_at')) return;

  db.exec('ALTER TABLE storage_channels ADD COLUMN deleted_at DATETIME');
  log.info('迁移：storage_channels.deleted_at 已添加');
}

/**
 * v001 迁移：为 files 添加 status 列，并创建配套复合索引。
 * status 取值：active（正常）、channel_deleted（渠道逻辑删除后冻结）。
 * @param {import('better-sqlite3').Database} db
 */
export function migrateFilesStatus(db) {
  const cols = db.pragma('table_info(files)').map(c => c.name);
  if (!cols.includes('status')) {
    db.exec("ALTER TABLE files ADD COLUMN status TEXT NOT NULL DEFAULT 'active'");
    // 回填：理论上 DEFAULT 已覆盖，但存量空值行手动补齐
    db.exec("UPDATE files SET status = 'active' WHERE status IS NULL OR status = ''");
    log.info('迁移：files.status 已添加并回填');
  }

  // 复合索引：CREATE INDEX IF NOT EXISTS 幂等
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_files_status_created_at
      ON files(status, created_at DESC);

    CREATE INDEX IF NOT EXISTS idx_files_status_directory_created_at
      ON files(status, directory, created_at DESC);

    CREATE INDEX IF NOT EXISTS idx_files_status_storage_instance
      ON files(status, storage_instance_id);
  `);
}

/**
 * v001 迁移：重建 storage_quota_cache 触发器，使其仅统计 status = 'active' 的文件。
 *
 * CREATE TRIGGER IF NOT EXISTS 不会替换已存在的触发器，因此必须先 DROP 再 CREATE。
 * 对已是最新版本（含 status 过滤）的触发器，DROP + CREATE 仍是安全幂等的。
 * @param {import('better-sqlite3').Database} db
 */
function applyV001QuotaCacheTriggerMigration(db) {
  db.exec('DROP TRIGGER IF EXISTS trg_quota_cache_after_insert');
  db.exec('DROP TRIGGER IF EXISTS trg_quota_cache_after_delete');
  db.exec('DROP TRIGGER IF EXISTS trg_quota_cache_after_update');

  // INSERT 触发器：仅 active 文件计入
  db.exec(`
    CREATE TRIGGER trg_quota_cache_after_insert
    AFTER INSERT ON files
    WHEN NEW.storage_instance_id IS NOT NULL AND NEW.status = 'active'
    BEGIN
      INSERT INTO storage_quota_cache (storage_id, used_bytes, file_count, last_updated)
      VALUES (NEW.storage_instance_id, NEW.size, 1, CURRENT_TIMESTAMP)
      ON CONFLICT(storage_id) DO UPDATE SET
        used_bytes = storage_quota_cache.used_bytes + NEW.size,
        file_count = storage_quota_cache.file_count + 1,
        last_updated = CURRENT_TIMESTAMP;
    END;
  `);

  // DELETE 触发器：仅 active 文件扣减
  db.exec(`
    CREATE TRIGGER trg_quota_cache_after_delete
    AFTER DELETE ON files
    WHEN OLD.storage_instance_id IS NOT NULL AND OLD.status = 'active'
    BEGIN
      UPDATE storage_quota_cache
      SET
        used_bytes = MAX(0, used_bytes - OLD.size),
        file_count = MAX(0, file_count - 1),
        last_updated = CURRENT_TIMESTAMP
      WHERE storage_id = OLD.storage_instance_id;
    END;
  `);

  // UPDATE 触发器：覆盖四种场景
  db.exec(`
    CREATE TRIGGER trg_quota_cache_after_update
    AFTER UPDATE ON files
    WHEN OLD.storage_instance_id IS NOT NULL OR NEW.storage_instance_id IS NOT NULL
    BEGIN
      -- 情况1: 同一渠道 active->active，只是 size 变化
      UPDATE storage_quota_cache
      SET
        used_bytes = storage_quota_cache.used_bytes - OLD.size + NEW.size,
        last_updated = CURRENT_TIMESTAMP
      WHERE storage_id = OLD.storage_instance_id
        AND OLD.storage_instance_id IS NOT NULL
        AND NEW.storage_instance_id IS NOT NULL
        AND OLD.storage_instance_id = NEW.storage_instance_id
        AND OLD.status = 'active'
        AND NEW.status = 'active';

      -- 情况2: active -> 非active（冻结），从渠道扣减
      UPDATE storage_quota_cache
      SET
        used_bytes = MAX(0, storage_quota_cache.used_bytes - OLD.size),
        file_count = MAX(0, storage_quota_cache.file_count - 1),
        last_updated = CURRENT_TIMESTAMP
      WHERE storage_id = OLD.storage_instance_id
        AND OLD.storage_instance_id IS NOT NULL
        AND OLD.status = 'active'
        AND NEW.status != 'active';

      -- 情况3: 非active -> active（解冻），向渠道增加
      INSERT INTO storage_quota_cache (storage_id, used_bytes, file_count, last_updated)
      VALUES (NEW.storage_instance_id, NEW.size, 1, CURRENT_TIMESTAMP)
      ON CONFLICT(storage_id) DO UPDATE SET
        used_bytes = storage_quota_cache.used_bytes + NEW.size,
        file_count = storage_quota_cache.file_count + 1,
        last_updated = CURRENT_TIMESTAMP
      WHERE NEW.storage_instance_id IS NOT NULL
        AND OLD.status != 'active'
        AND NEW.status = 'active';

      -- 情况4: active 且 storage_instance_id 跨渠道变化（迁移）- 从旧渠道扣减
      UPDATE storage_quota_cache
      SET
        used_bytes = MAX(0, storage_quota_cache.used_bytes - OLD.size),
        file_count = MAX(0, storage_quota_cache.file_count - 1),
        last_updated = CURRENT_TIMESTAMP
      WHERE storage_id = OLD.storage_instance_id
        AND OLD.storage_instance_id IS NOT NULL
        AND (NEW.storage_instance_id IS NULL OR OLD.storage_instance_id != NEW.storage_instance_id)
        AND OLD.status = 'active'
        AND NEW.status = 'active';

      -- 情况4续: active 且 storage_instance_id 跨渠道变化（迁移）- 向新渠道增加
      INSERT INTO storage_quota_cache (storage_id, used_bytes, file_count, last_updated)
      VALUES (NEW.storage_instance_id, NEW.size, 1, CURRENT_TIMESTAMP)
      ON CONFLICT(storage_id) DO UPDATE SET
        used_bytes = storage_quota_cache.used_bytes + NEW.size,
        file_count = storage_quota_cache.file_count + 1,
        last_updated = CURRENT_TIMESTAMP
      WHERE NEW.storage_instance_id IS NOT NULL
        AND (OLD.storage_instance_id IS NULL OR OLD.storage_instance_id != NEW.storage_instance_id)
        AND OLD.status = 'active'
        AND NEW.status = 'active';
    END;
  `);

  log.info('迁移：storage_quota_cache 触发器已重建（含 status 过滤）');
}

/**
 * v001 迁移入口：按序执行所有 v001 步骤。
 * @param {import('better-sqlite3').Database} db
 */
export function migrateV001(db) {
  migrateStorageChannelsDeletedAt(db);
  migrateFilesStatus(db);
  applyV001QuotaCacheTriggerMigration(db);
}
