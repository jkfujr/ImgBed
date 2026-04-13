import {
  parseStorageMeta,
  resolveStorageInstanceId,
  serializeStorageMeta,
} from '../../utils/storage-meta.js';

/**
 * 判断是否为"仅删索引"模式
 */
function isIndexOnlyMode(mode) {
  return mode === 'index_only';
}

async function removeStoredArtifacts({
  storageManager,
  storageId,
  storageKey,
  deleteToken = null,
  isChunked = false,
  chunkRecords = [],
  deleteMode = 'remote_and_index',
}) {
  // 仅删索引模式下跳过所有远端删除
  if (isIndexOnlyMode(deleteMode)) {
    return;
  }

  if (isChunked) {
    for (const chunk of chunkRecords) {
      const chunkStorage = storageManager.getStorage(chunk.storage_id);
      if (!chunkStorage) {
        throw new Error(`分块渠道不可用: ${chunk.storage_id}`);
      }
      const chunkMeta = parseStorageMeta(chunk.storage_meta);
      const deleted = await chunkStorage.deleteChunk(chunk.storage_key, chunkMeta.deleteToken || null);
      if (deleted === false) {
        throw new Error(`分块删除失败: ${chunk.storage_key}`);
      }
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

  const deleted = await storage.delete(storageKey, deleteToken);
  if (deleted === false) {
    throw new Error(`存储对象删除失败: ${storageKey}`);
  }
}

export {
  parseStorageMeta,
  serializeStorageMeta,
  resolveStorageInstanceId,
  isIndexOnlyMode,
  removeStoredArtifacts,
};
