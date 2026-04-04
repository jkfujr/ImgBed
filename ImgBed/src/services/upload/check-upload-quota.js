async function checkUploadQuota({ channelId, storageManager, db, config }) {
  const checkMode = config.upload?.quotaCheckMode || 'auto';

  if (checkMode !== 'always') {
    return storageManager.isUploadAllowed(channelId);
  }

  try {
    const result = await db
      .selectFrom('files')
      .select(['size', 'storage_config'])
      .execute();

    let totalBytes = 0;
    for (const row of result) {
      let storageConfig = {};
      try {
        storageConfig = JSON.parse(row.storage_config || '{}');
      } catch {}

      if (storageConfig.instance_id === channelId) {
        totalBytes += Number(row.size) || 0;
      }
    }

    return !storageManager.isQuotaExceeded(channelId, totalBytes);
  } catch (err) {
    console.warn('[Upload] 容量检查失败，继续上传:', err.message);
    return true;
  }
}

module.exports = {
  checkUploadQuota,
};
