import fs from 'fs';
import { createLogger } from '../utils/logger.js';

const log = createLogger('database:migrations');

/**
 * 当前迁移目标版本号。
 * 每次新增迁移步骤时递增此值。
 */
const CURRENT_VERSION = 1;

/**
 * 对老数据库执行增量 schema 迁移。
 *
 * 设计原则：
 * - 以 PRAGMA user_version 记录已完成的迁移版本，避免重复执行。
 * - 实际执行迁移前自动备份数据库文件（带时间戳后缀），已是最新版本时跳过备份。
 * - 新数据库（由 initDb 创建）已含目标 schema，首次迁移会快速通过列检测后写入版本号。
 * - 触发器不能用 CREATE TRIGGER IF NOT EXISTS 替换，必须 DROP + CREATE。
 *
 * @param {import('better-sqlite3').Database} sqlite
 * @param {string} dbPath 数据库文件绝对路径，用于备份
 */
function runMigrations(sqlite, dbPath) {
  try {
    // 确保迁移版本表存在（对新库和老库均幂等）
    sqlite.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      applied_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);

    const row = sqlite.prepare('SELECT MAX(version) AS v FROM schema_migrations').get();
    const currentVersion = row?.v ?? 0;

    if (currentVersion >= CURRENT_VERSION) {
      log.info({ version: currentVersion }, '数据库已是最新版本，跳过迁移');
      return;
    }

    // 迁移前备份数据库文件
    if (dbPath && fs.existsSync(dbPath)) {
      const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
      const backupPath = `${dbPath}.backup-v${currentVersion}-${ts}`;
      fs.copyFileSync(dbPath, backupPath);
      log.info({ backupPath }, '迁移前数据库已备份');
    }

    log.info({ from: currentVersion, to: CURRENT_VERSION }, '开始数据库迁移');

    if (currentVersion < 1) {
      _migrateStorageChannelsDeletedAt(sqlite);
      _migrateFilesStatus(sqlite);
      _rebuildQuotaCacheTriggers(sqlite);
      sqlite.prepare('INSERT OR IGNORE INTO schema_migrations (version) VALUES (?)').run(1);
    }

    log.info({ version: CURRENT_VERSION }, '数据库迁移完成');
  } catch (err) {
    log.error({ err }, '数据库迁移失败');
    throw err;
  }
}

/**
 * 增量迁移：为 storage_channels 添加 deleted_at 列（逻辑删除时间戳）。
 */
function _migrateStorageChannelsDeletedAt(sqlite) {
  const cols = sqlite.pragma('table_info(storage_channels)').map(c => c.name);
  if (cols.includes('deleted_at')) return;

  sqlite.exec('ALTER TABLE storage_channels ADD COLUMN deleted_at DATETIME');
  log.info('迁移：storage_channels.deleted_at 已添加');
}

/**
 * 增量迁移：为 files 添加 status 列，并创建配套复合索引。
 * status 取值：active（正常）、channel_deleted（渠道逻辑删除后冻结）。
 */
function _migrateFilesStatus(sqlite) {
  const cols = sqlite.pragma('table_info(files)').map(c => c.name);
  if (!cols.includes('status')) {
    sqlite.exec("ALTER TABLE files ADD COLUMN status TEXT NOT NULL DEFAULT 'active'");
    // 回填：理论上 DEFAULT 已覆盖，但存量空值行手动补齐
    sqlite.exec("UPDATE files SET status = 'active' WHERE status IS NULL OR status = ''");
    log.info('迁移：files.status 已添加并回填');
  }

  // 复合索引：CREATE INDEX IF NOT EXISTS 幂等
  sqlite.exec(`
    CREATE INDEX IF NOT EXISTS idx_files_status_created_at
    ON files(status, created_at DESC);

    CREATE INDEX IF NOT EXISTS idx_files_status_directory_created_at
    ON files(status, directory, created_at DESC);

    CREATE INDEX IF NOT EXISTS idx_files_status_storage_instance
    ON files(status, storage_instance_id);
  `);
}

/**
 * 重建 storage_quota_cache 触发器，使其仅统计 status = 'active' 的文件。
 *
 * CREATE TRIGGER IF NOT EXISTS 不会替换已存在的触发器，因此必须先 DROP 再 CREATE。
 * 对已是最新版本（含 status 过滤）的触发器，DROP + CREATE 仍是安全幂等的。
 */
function _rebuildQuotaCacheTriggers(sqlite) {
  sqlite.exec('DROP TRIGGER IF EXISTS trg_quota_cache_after_insert');
  sqlite.exec('DROP TRIGGER IF EXISTS trg_quota_cache_after_delete');
  sqlite.exec('DROP TRIGGER IF EXISTS trg_quota_cache_after_update');

  // INSERT 触发器：仅 active 文件计入
  sqlite.exec(`
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
  sqlite.exec(`
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
  //   1. 同渠道 active→active，size 变化
  //   2. active→非active（冻结），从渠道扣减
  //   3. 非active→active（解冻），向渠道增加
  //   4. active 跨渠道迁移，旧渠道扣减 + 新渠道增加
  sqlite.exec(`
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

export { runMigrations };
