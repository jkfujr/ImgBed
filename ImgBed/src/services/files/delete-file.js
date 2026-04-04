function parseStorageConfig(storageConfig) {
  try {
    return JSON.parse(storageConfig || '{}');
  } catch {
    return {};
  }
}

async function deleteFileRecord(fileRecord, { db, storageManager, ChunkManager, logger = console }) {
  const configObj = parseStorageConfig(fileRecord.storage_config);
  const instanceId = configObj.instance_id;

  if (instanceId) {
    const storage = storageManager.getStorage(instanceId);
    if (storage) {
      await storage.delete(fileRecord.storage_key).catch((err) => {
        logger.warn('[Files API] 底层存储提供方远程删除失败 (忽略并继续清理引用):', err.message);
      });
    }

    const fileSize = Number(fileRecord.size) || 0;
    if (fileSize > 0) {
      storageManager.updateQuotaCache(instanceId, -fileSize);
    }
  }

  if (fileRecord.is_chunked) {
    await ChunkManager.deleteChunks(fileRecord.id, (storageId) => storageManager.getStorage(storageId)).catch((err) => {
      logger.warn('[Files API] 分块清理失败（忽略）:', err.message);
    });
  }

  await db.deleteFrom('files').where('id', '=', fileRecord.id).execute();

  if (instanceId) {
    storageManager.recordDelete(instanceId);
  }

  return {
    id: fileRecord.id,
    instanceId,
  };
}

async function deleteFilesBatch(files, deps) {
  let deletedCount = 0;

  for (const fileRecord of files) {
    await deleteFileRecord(fileRecord, deps);
    deletedCount++;
  }

  return deletedCount;
}

module.exports = {
  parseStorageConfig,
  deleteFileRecord,
  deleteFilesBatch,
};
