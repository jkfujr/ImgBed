import pLimit from 'p-limit';
import {
  buildQuotaEvent,
  createStorageOperation,
  insertQuotaEvents,
  markOperationCommitted,
  markOperationCompensationPending,
  markOperationCompleted,
} from '../system/storage-operations.js';
import { parseStorageConfig, removeStoredArtifacts } from './storage-artifacts.js';

async function deleteFileRecord(fileRecord, { db, storageManager, ChunkManager, logger = console }) {
  const configObj = parseStorageConfig(fileRecord.storage_config);
  const instanceId = fileRecord.storage_instance_id || configObj.instance_id || null;
  const fileSize = Number(fileRecord.size) || 0;
  const chunkRecords = fileRecord.is_chunked ? await ChunkManager.getChunks(fileRecord.id) : [];

  const compensationPayload = {
    storageId: instanceId,
    storageKey: fileRecord.storage_key,
    isChunked: Boolean(fileRecord.is_chunked),
    chunkRecords,
  };

  const operationId = createStorageOperation(db, {
    operationType: 'delete',
    fileId: fileRecord.id,
    sourceStorageId: instanceId,
    payload: compensationPayload,
  });

  const persistDelete = db.transaction(() => {
    db.prepare('DELETE FROM chunks WHERE file_id = ?').run(fileRecord.id);
    db.prepare('DELETE FROM files WHERE id = ?').run(fileRecord.id);

    if (instanceId) {
      insertQuotaEvents(db, [buildQuotaEvent({
        operationId,
        fileId: fileRecord.id,
        storageId: instanceId,
        eventType: 'delete',
        bytesDelta: -fileSize,
        fileCountDelta: -1,
        payload: { storageKey: fileRecord.storage_key },
      })]);
    }

    markOperationCommitted(db, operationId, { sourceStorageId: instanceId });
  });

  persistDelete();
  await storageManager.applyPendingQuotaEvents({ operationId, adjustUsageStats: true });

  try {
    await removeStoredArtifacts({
      storageManager,
      storageId: instanceId,
      storageKey: fileRecord.storage_key,
      isChunked: Boolean(fileRecord.is_chunked),
      chunkRecords,
    });
    markOperationCompleted(db, operationId);
  } catch (err) {
    markOperationCompensationPending(db, operationId, {
      sourceStorageId: instanceId,
      compensationPayload,
      error: err,
    });
    logger.warn(`[Files API] 文件 ${fileRecord.id} 已提交本地删除，但远程清理待补偿: ${err.message}`);
    throw err;
  }

  return {
    id: fileRecord.id,
    instanceId,
  };
}

async function deleteFilesBatch(files, deps) {
  const limit = pLimit(3);
  const tasks = files.map((fileRecord) =>
    limit(() => deleteFileRecord(fileRecord, deps))
  );

  await Promise.all(tasks);
  return files.length;
}

export {
  deleteFileRecord,
  deleteFilesBatch,
};
