import pLimit from 'p-limit';

function parseStorageConfig(storageConfig) {
  try {
    return JSON.parse(storageConfig || '{}');
  } catch {
    return {};
  }
}

async function deleteFileRecord(fileRecord, { db, storageManager, ChunkManager, logger = console }) {
  const configObj = parseStorageConfig(fileRecord.storage_config);
  const instanceId = fileRecord.storage_instance_id || configObj.instance_id;

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

  db.prepare('DELETE FROM files WHERE id = ?').run(fileRecord.id);

  if (instanceId) {
    storageManager.recordDelete(instanceId);
  }

  return {
    id: fileRecord.id,
    instanceId,
  };
}

async function deleteFilesBatch(files, deps) {
  const { db } = deps;
  const limit = pLimit(5); // 并发度为 5

  // 并行删除物理存储和分块
  const deleteStorageTasks = files.map(fileRecord =>
    limit(async () => {
      const configObj = parseStorageConfig(fileRecord.storage_config);
      const instanceId = fileRecord.storage_instance_id || configObj.instance_id;
      const fileSize = Number(fileRecord.size) || 0;

      if (instanceId) {
        const storage = deps.storageManager.getStorage(instanceId);
        if (storage) {
          await storage.delete(fileRecord.storage_key).catch((err) => {
            deps.logger?.warn('[Files API] 底层存储提供方远程删除失败 (忽略并继续清理引用):', err.message);
          });
        }
      }

      if (fileRecord.is_chunked) {
        await deps.ChunkManager.deleteChunks(fileRecord.id, (storageId) => deps.storageManager.getStorage(storageId)).catch((err) => {
          deps.logger?.warn('[Files API] 分块清理失败（忽略）:', err.message);
        });
      }

      return { fileRecord, instanceId, fileSize };
    })
  );

  const storageResults = await Promise.all(deleteStorageTasks);

  // 数据库删除在事务中批量执行
  const runDelete = () => {
    for (const { fileRecord } of storageResults) {
      db.prepare('DELETE FROM files WHERE id = ?').run(fileRecord.id);
    }
  };

  if (typeof db.transaction === 'function') {
    db.transaction(runDelete)();
  } else {
    runDelete();
  }

  for (const { instanceId, fileSize } of storageResults) {
    if (instanceId) {
      if (fileSize > 0) {
        deps.storageManager.updateQuotaCache(instanceId, -fileSize);
      }
      deps.storageManager.recordDelete(instanceId);
    }
  }

  return storageResults.length;
}

export { parseStorageConfig,
  deleteFileRecord,
  deleteFilesBatch, };
