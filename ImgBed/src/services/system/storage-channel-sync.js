/**
 * 在数据库中插入新的存储渠道元数据
 */
async function insertStorageChannelMeta(storage, db) {
  db.prepare(`INSERT OR REPLACE INTO storage_channels (
    id, name, type, enabled, allow_upload, weight, quota_limit_gb
  ) VALUES (?, ?, ?, ?, ?, ?, ?)`)
    .run(
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
async function updateStorageChannelMeta(id, storage, db) {
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
 * 在数据库中删除存储渠道元数据及其历史记录（物理删除，保留用于内部清理）
 */
async function deleteStorageChannelMeta(id, db) {
  db.prepare('DELETE FROM storage_channels WHERE id = ?').run(id);
  db.prepare('DELETE FROM storage_operations WHERE source_storage_id = ? OR target_storage_id = ?').run(id, id);
  db.prepare('DELETE FROM storage_quota_events WHERE storage_id = ?').run(id);
  db.prepare('DELETE FROM storage_quota_history WHERE storage_id = ?').run(id);
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
    db.prepare(`
      UPDATE storage_channels
      SET deleted_at = CURRENT_TIMESTAMP, enabled = 0, allow_upload = 0
      WHERE id = ?
    `).run(id);

    db.prepare(`
      UPDATE files
      SET status = 'channel_deleted'
      WHERE storage_instance_id = ? AND status = 'active'
    `).run(id);
  })();
}

/**
 * 同步配置文件中的所有存储渠道到数据库
 */
async function syncAllStorageChannels(config, db) {
  const storages = config.storage?.storages || [];
  for (const storage of storages) {
    await insertStorageChannelMeta(storage, db);
  }
}

export { insertStorageChannelMeta,
  updateStorageChannelMeta,
  deleteStorageChannelMeta,
  markStorageChannelDeleted,
  syncAllStorageChannels, };

