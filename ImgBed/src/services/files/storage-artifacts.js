function parseStorageConfig(storageConfig) {
  try {
    return JSON.parse(storageConfig || '{}');
  } catch {
    return {};
  }
}

async function removeStoredArtifacts({
  storageManager,
  storageId,
  storageKey,
  isChunked = false,
  chunkRecords = [],
}) {
  if (isChunked) {
    for (const chunk of chunkRecords) {
      const chunkStorage = storageManager.getStorage(chunk.storage_id);
      if (!chunkStorage) {
        throw new Error(`分块渠道不可用: ${chunk.storage_id}`);
      }
      await chunkStorage.deleteChunk(chunk.storage_key);
    }
    return;
  }

  if (!storageId || !storageKey) {
    return;
  }

  const storage = storageManager.getStorage(storageId);
  if (!storage) {
    throw new Error(`存储渠道不可用: ${storageId}`);
  }

  await storage.delete(storageKey);
}

export {
  parseStorageConfig,
  removeStoredArtifacts,
};
