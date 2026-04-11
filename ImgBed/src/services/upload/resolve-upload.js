function createUploadError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function resolveUploadChannel(body, storageManager, config) {
  let channelId = body['channel'];
  if (!channelId) {
    const strategy = config.storage?.loadBalanceStrategy || 'default';
    if (strategy !== 'default') {
      const preferredType = body['preferredType'] || null;
      channelId = storageManager.selectUploadChannel(preferredType);
    }
    if (!channelId) {
      channelId = storageManager.getDefaultStorageId();
    }
  }

  if (!channelId) {
    throw createUploadError(500, '服务端未指定任何默认存储渠道');
  }

  const storage = storageManager.getStorage(channelId);
  if (!storage) {
    throw createUploadError(500, `默认存储渠道不可用或不存在: ${channelId}`);
  }

  return { channelId, storage };
}

export { resolveUploadChannel,
  createUploadError, };
