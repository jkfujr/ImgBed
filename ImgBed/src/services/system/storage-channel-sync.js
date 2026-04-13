import {
  freezeFilesByMissingOrDeletedStorageChannels,
  freezeFilesByStorageInstance,
} from '../../database/files-dao.js';

/**
 * 在数据库中插入新的存储渠道元数据
 */
function insertStorageChannelMeta(storage, db) {
  db.prepare(`
    INSERT INTO storage_channels (
      id, name, type, enabled, allow_upload, weight, quota_limit_gb
    ) VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      name = excluded.name,
      type = excluded.type,
      enabled = CASE
        WHEN storage_channels.deleted_at IS NULL THEN excluded.enabled
        ELSE 0
      END,
      allow_upload = CASE
        WHEN storage_channels.deleted_at IS NULL THEN excluded.allow_upload
        ELSE 0
      END,
      weight = excluded.weight,
      quota_limit_gb = excluded.quota_limit_gb
  `).run(
    storage.id,
    storage.name,
    storage.type,
    storage.enabled ? 1 : 0,
    storage.allowUpload ? 1 : 0,
    storage.weight,
    storage.quotaLimitGB
  );
}

/**
 * 在数据库中更新存储渠道元数据
 */
function updateStorageChannelMeta(id, storage, db) {
  db.prepare(`UPDATE storage_channels SET
    name = ?, enabled = ?, allow_upload = ?, weight = ?, quota_limit_gb = ?
    WHERE id = ?`)
    .run(
      storage.name,
      storage.enabled ? 1 : 0,
      storage.allowUpload ? 1 : 0,
      storage.weight,
      storage.quotaLimitGB,
      id
    );
}

/**
 * 逻辑删除存储渠道：标记 deleted_at，禁用渠道，并冻结关联文件索引。
 * 保留 storage_channels、quota_events、quota_history、storage_operations 历史，不做物理清除。
 *
 * @param {string} id - 渠道 storage_instance_id
 * @param {import('better-sqlite3').Database} db
 */
function markStorageChannelDeleted(id, db) {
  db.transaction(() => {
    markStorageChannelDeletedInPlace(id, db);
  })();
}

function markStorageChannelDeletedInPlace(id, db) {
  db.prepare(`
    UPDATE storage_channels
    SET deleted_at = CURRENT_TIMESTAMP, enabled = 0, allow_upload = 0
    WHERE id = ?
  `).run(id);

  freezeFilesByStorageInstance(db, id);
}

/**
 * 同步配置文件中的所有存储渠道到数据库
 */
function syncAllStorageChannels(config, db) {
  const storages = config.storage?.storages || [];
  const configuredIds = new Set(storages.map((storage) => storage.id));

  db.transaction(() => {
    for (const storage of storages) {
      insertStorageChannelMeta(storage, db);
    }

    const dbChannels = db.prepare('SELECT id, deleted_at FROM storage_channels').all();
    for (const channel of dbChannels) {
      if (!configuredIds.has(channel.id) && channel.deleted_at == null) {
        markStorageChannelDeletedInPlace(channel.id, db);
      }
    }

    freezeFilesByMissingOrDeletedStorageChannels(db);
  })();
}

export { insertStorageChannelMeta,
  updateStorageChannelMeta,
  markStorageChannelDeleted,
  syncAllStorageChannels, };
