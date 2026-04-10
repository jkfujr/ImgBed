/**
 * storage_quota_cache 表 DDL + 3 个跨表触发器。
 *
 * 触发器挂在 files 表上（AFTER INSERT/DELETE/UPDATE ON files），
 * 实时维护 storage_quota_cache 的 used_bytes 和 file_count。
 * 语义上属于 quota_cache 维护逻辑，集中在此文件管理。
 *
 * 注意：此模块必须在 files 表创建后调用。
 * 新库使用 CREATE TRIGGER IF NOT EXISTS（幂等），
 * 迁移场景（需要替换旧触发器）使用 migrations/v001.js 中的 DROP + CREATE。
 *
 * @param {import('better-sqlite3').Database} db
 */
export function createStorageQuotaCacheSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS storage_quota_cache (
      storage_id TEXT PRIMARY KEY,
      used_bytes INTEGER NOT NULL DEFAULT 0,
      file_count INTEGER NOT NULL DEFAULT 0,
      last_updated DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CHECK (used_bytes >= 0),
      CHECK (file_count >= 0)
    );

    CREATE INDEX IF NOT EXISTS idx_storage_quota_cache_last_updated
      ON storage_quota_cache(last_updated DESC);

    -- INSERT 触发器：仅 active 文件计入
    CREATE TRIGGER IF NOT EXISTS trg_quota_cache_after_insert
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

    -- DELETE 触发器：仅 active 文件扣减
    CREATE TRIGGER IF NOT EXISTS trg_quota_cache_after_delete
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

    -- UPDATE 触发器：覆盖同渠道size变化、冻结/解冻、跨渠道迁移四种场景
    CREATE TRIGGER IF NOT EXISTS trg_quota_cache_after_update
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
}
