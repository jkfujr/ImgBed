import pLimit from 'p-limit';
import { createLogger } from '../../utils/logger.js';
import {
  buildQuotaEvent,
  createStorageOperation,
  insertQuotaEvents,
  markOperationCommitted,
  markOperationCompensationPending,
  markOperationCompleted,
  markOperationRemoteDone,
} from '../system/storage-operations.js';
import { parseStorageConfig, removeStoredArtifacts } from './storage-artifacts.js';

const log = createLogger('delete-file');

async function deleteFileRecord(fileRecord, { db, storageManager, ChunkManager, logger = log }) {
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

  try {
    await removeStoredArtifacts({
      storageManager,
      storageId: instanceId,
      storageKey: fileRecord.storage_key,
      isChunked: Boolean(fileRecord.is_chunked),
      chunkRecords,
    });
    markOperationRemoteDone(db, operationId, {
      sourceStorageId: instanceId,
      remotePayload: { deletedAt: new Date().toISOString() },
    });
  } catch (err) {
    markOperationCompensationPending(db, operationId, {
      sourceStorageId: instanceId,
      compensationPayload,
      error: err,
    });
    logger.warn(`[Files API] 文件 ${fileRecord.id} 远端清理失败，本地记录保留，已标记待补偿: ${err.message}`);
    throw err;
  }

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

    markOperationCommitted(db, operationId, {
      sourceStorageId: instanceId,
      compensationPayload,
    });
  });

  persistDelete();
  await storageManager.applyPendingQuotaEvents({ operationId, adjustUsageStats: true });
  markOperationCompleted(db, operationId);

  return {
    id: fileRecord.id,
    instanceId,
  };
}

async function deleteFilesBatch(files, deps) {
  const limit = pLimit(3);
  const results = {
    total: files.length,
    success: 0,
    failed: 0,
    errors: [],
  };

  const tasks = files.map((fileRecord) =>
    limit(async () => {
      try {
        await deleteFileRecord(fileRecord, deps);
        return { fileRecord, success: true };
      } catch (err) {
        return { fileRecord, success: false, error: err };
      }
    })
  );

  const taskResults = await Promise.all(tasks);

  for (const item of taskResults) {
    if (item.success) {
      results.success++;
      continue;
    }

    results.failed++;
    results.errors.push({
      id: item.fileRecord.id,
      reason: item.error?.message || '删除失败',
    });
  }

  return results;
}

export {
  deleteFileRecord,
  deleteFilesBatch,
};
