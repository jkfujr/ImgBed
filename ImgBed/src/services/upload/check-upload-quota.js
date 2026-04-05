async function checkUploadQuota({ channelId, storageManager, db, config }) {
  const checkMode = config.upload?.quotaCheckMode || 'auto';

  if (checkMode !== 'always') {
    return storageManager.isUploadAllowed(channelId);
  }

  try {
    const result = db.prepare('SELECT size, storage_instance_id, storage_config FROM files').all();

    let totalBytes = 0;
    for (const row of result) {
      let instanceId = row.storage_instance_id;
      if (!instanceId) {
        let storageConfig = {};
        try {
          storageConfig = JSON.parse(row.storage_config || '{}');
        } catch {}
        instanceId = storageConfig.instance_id;
      }

      if (instanceId === channelId) {
        totalBytes += Number(row.size) || 0;
      }
    }

    return !storageManager.isQuotaExceeded(channelId, totalBytes);
  } catch (err) {
    console.warn('[Upload] 容量检查失败，继续上传:', err.message);
    return true;
  }
}

export { checkUploadQuota, };
