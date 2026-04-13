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
import {
  isIndexOnlyMode,
  parseStorageMeta,
  removeStoredArtifacts,
  resolveStorageInstanceId,
} from './storage-artifacts.js';
import { deleteFileById } from '../../database/files-dao.js';

const log = createLogger('delete-file');

/**
 * 删除单条文件记录
 * @param {Object} fileRecord - 文件数据库记录
 * @param {Object} deps - 依赖注入
 * @param {Object} deps.db
 * @param {Object} deps.storageManager
 * @param {Object} deps.ChunkManager
 * @param {string} [deps.deleteMode] - 'remote_and_index' | 'index_only'
 * @param {Object} [logger]
 */
async function deleteFileRecord(fileRecord, { db, storageManager, ChunkManager, deleteMode = 'remote_and_index', logger = log }) {
  const storageMeta = parseStorageMeta(fileRecord.storage_meta);
  const instanceId = resolveStorageInstanceId(fileRecord);
  const fileSize = Number(fileRecord.size) || 0;
  const chunkRecords = fileRecord.is_chunked ? await ChunkManager.getChunks(fileRecord.id) : [];

  const compensationPayload = {
    storageId: instanceId,
    storageKey: fileRecord.storage_key,
    deleteToken: storageMeta.deleteToken || null,
    isChunked: Boolean(fileRecord.is_chunked),
    chunkRecords,
    deleteMode,
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
      deleteToken: storageMeta.deleteToken || null,
      isChunked: Boolean(fileRecord.is_chunked),
      chunkRecords,
      deleteMode,
    });
    markOperationRemoteDone(db, operationId, {
      sourceStorageId: instanceId,
      remotePayload: {
        storageId: instanceId,
        storageKey: fileRecord.storage_key,
        deleteToken: storageMeta.deleteToken || null,
        isChunked: Boolean(fileRecord.is_chunked),
        chunkRecords,
        deleteMode,
        deletedAt: new Date().toISOString(),
      },
    });
  } catch (err) {
    // 仅删索引模式下，远端删除失败不阻止流程
    if (isIndexOnlyMode(deleteMode)) {
      logger.warn(`[delete-file] 仅删索引模式：远端删除失败跳过 — ${err.message}`);
    } else {
      markOperationCompensationPending(db, operationId, {
        sourceStorageId: instanceId,
        compensationPayload,
        error: err,
      });
      logger.warn(`[delete-file] 文件 ${fileRecord.id} 远端清理失败，本地记录保留，已标记待补偿: ${err.message}`);
      throw err;
    }
  }

  const persistDelete = db.transaction(() => {
    db.prepare('DELETE FROM chunks WHERE file_id = ?').run(fileRecord.id);
    deleteFileById(db, fileRecord.id);

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

/**
 * 批量删除文件记录
 * @param {Object[]} files - 文件记录数组
 * @param {Object} deps - 依赖注入
 * @param {string} [deps.deleteMode] - 'remote_and_index' | 'index_only'
 */
async function deleteFilesBatch(files, deps) {
  const limit = pLimit(3);
  const { deleteMode = 'remote_and_index' } = deps;

  const results = {
    total: files.length,
    success: 0,
    failed: 0,
    errors: [],
  };

  const tasks = files.map((fileRecord) =>
    limit(async () => {
      try {
        await deleteFileRecord(fileRecord, { ...deps, deleteMode });
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
