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
  const { db } = deps;

  // 使用事务批量提交数据库操作
  await db.transaction().execute(async (trx) => {
    for (const fileRecord of files) {
      const configObj = parseStorageConfig(fileRecord.storage_config);
      const instanceId = configObj.instance_id;

      // 物理删除（存储层）
      if (instanceId) {
        const storage = deps.storageManager.getStorage(instanceId);
        if (storage) {
          await storage.delete(fileRecord.storage_key).catch((err) => {
            deps.logger?.warn('[Files API] 底层存储提供方远程删除失败 (忽略并继续清理引用):', err.message);
          });
        }

        const fileSize = Number(fileRecord.size) || 0;
        if (fileSize > 0) {
          deps.storageManager.updateQuotaCache(instanceId, -fileSize);
        }
      }

      // 分块清理
      if (fileRecord.is_chunked) {
        await deps.ChunkManager.deleteChunks(fileRecord.id, (storageId) => deps.storageManager.getStorage(storageId)).catch((err) => {
          deps.logger?.warn('[Files API] 分块清理失败（忽略）:', err.message);
        });
      }

      // 数据库删除（在事务内）
      await trx.deleteFrom('files').where('id', '=', fileRecord.id).execute();

      // 记录删除统计
      if (instanceId) {
        deps.storageManager.recordDelete(instanceId);
      }

      deletedCount++;
    }
  });

  return deletedCount;
}

module.exports = {
  parseStorageConfig,
  deleteFileRecord,
  deleteFilesBatch,
};
