/**
 * 在数据库中插入新的存储渠道元数据
 */
async function insertStorageChannelMeta(storage, db) {
  await db.insertInto('storage_channels')
    .values({
      id: storage.id,
      name: storage.name,
      type: storage.type,
      enabled: storage.enabled ? 1 : 0,
      allow_upload: storage.allowUpload ? 1 : 0,
      weight: storage.weight,
      quota_limit_gb: storage.quotaLimitGB
    })
    .execute();
}

/**
 * 在数据库中更新存储渠道元数据
 */
async function updateStorageChannelMeta(id, storage, db) {
  await db.updateTable('storage_channels')
    .set({
      name: storage.name,
      enabled: storage.enabled ? 1 : 0,
      allow_upload: storage.allowUpload ? 1 : 0,
      weight: storage.weight,
      quota_limit_gb: storage.quotaLimitGB
    })
    .where('id', '=', id)
    .execute();
}

/**
 * 在数据库中删除存储渠道元数据及其历史记录
 */
async function deleteStorageChannelMeta(id, db) {
  await db.deleteFrom('storage_channels').where('id', '=', id).execute();
  await db.deleteFrom('storage_quota_history').where('storage_id', '=', id).execute();
}

module.exports = {
  insertStorageChannelMeta,
  updateStorageChannelMeta,
  deleteStorageChannelMeta,
};
