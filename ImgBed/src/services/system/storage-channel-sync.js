/**
 * 在数据库中插入新的存储渠道元数据
 */
async function insertStorageChannelMeta(storage, db) {
  db.prepare(`INSERT INTO storage_channels (
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
 * 在数据库中删除存储渠道元数据及其历史记录
 */
async function deleteStorageChannelMeta(id, db) {
  db.prepare('DELETE FROM storage_channels WHERE id = ?').run(id);
  db.prepare('DELETE FROM storage_operations WHERE source_storage_id = ? OR target_storage_id = ?').run(id, id);
  db.prepare('DELETE FROM storage_quota_events WHERE storage_id = ?').run(id);
  db.prepare('DELETE FROM storage_quota_history WHERE storage_id = ?').run(id);
}

export { insertStorageChannelMeta,
  updateStorageChannelMeta,
  deleteStorageChannelMeta, };
