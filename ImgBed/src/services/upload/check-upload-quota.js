async function checkUploadQuota({ channelId, storageManager }) {
  return storageManager.isUploadAllowed(channelId);
}

export { checkUploadQuota, };
