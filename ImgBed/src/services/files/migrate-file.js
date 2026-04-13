import pLimit from 'p-limit';

import { createLogger } from '../../utils/logger.js';
import { streamToBuffer } from '../../utils/stream.js';
import { toNodeReadable } from '../../utils/storage-io.js';
import ChunkManager from '../../storage/chunk-manager.js';
import { uploadToStorage } from '../upload/execute-upload.js';
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
  parseStorageMeta,
  removeStoredArtifacts,
  resolveStorageInstanceId,
  serializeStorageMeta,
} from './storage-artifacts.js';
import { updateFileMigrationFields } from '../../database/files-dao.js';

const log = createLogger('migrate-file');

const WRITABLE_STORAGE_TYPES = new Set(['local', 's3', 'huggingface']);

function createFilesError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function validateMigrationTarget(targetChannel, storageManager) {
  if (!targetChannel) {
    throw createFilesError(400, '迁移操作必须指定 target_channel（目标渠道ID）');
  }

  const targetEntry = storageManager.getStorageMeta(targetChannel);
  if (!targetEntry) {
    throw createFilesError(404, `目标渠道不存在: ${targetChannel}`);
  }

  if (!storageManager.isUploadAllowed(targetChannel)) {
    throw createFilesError(403, `目标渠道不支持写入: ${targetChannel}`);
  }

  if (!WRITABLE_STORAGE_TYPES.has(targetEntry.type)) {
    throw createFilesError(403, `目标渠道类型 ${targetEntry.type} 不支持作为迁移目标`);
  }

  return targetEntry;
}

/**
 * 读取源文件，返回 Node.js Readable 流（非分块）或分块流
 * 仅在分块场景下才读取完整 buffer（各块尺寸有限，不会 OOM）
 */
async function readSourceFileAsStream(fileRecord, storageManager) {
  const sourceInstanceId = resolveStorageInstanceId(fileRecord);

  if (!sourceInstanceId) {
    throw new Error('源文件缺少存储实例标识字段 storage_instance_id');
  }

  if (fileRecord.is_chunked) {
    const chunkRecords = await ChunkManager.getChunks(fileRecord.id);
    const stream = ChunkManager.createChunkedReadStream(
      chunkRecords,
      (storageId) => storageManager.getStorage(storageId),
      { totalSize: Number(fileRecord.size) || 0 }
    );
    return {
      sourceInstanceId,
      sourceChunkRecords: chunkRecords,
      stream,
    };
  }

  const sourceEntry = storageManager.getStorageMeta(sourceInstanceId);
  if (!sourceEntry) {
    throw new Error('源渠道不存在');
  }

  const readResult = await sourceEntry.instance.getStreamResponse(fileRecord.storage_key);
  return {
    sourceInstanceId,
    sourceChunkRecords: [],
    stream: toNodeReadable(readResult.stream),
  };
}

async function migrateFileRecord(fileRecord, { targetChannel, targetEntry, db, storageManager, logger = log }) {
  const sourceInstanceId = resolveStorageInstanceId(fileRecord);
  const sourceStorageMeta = parseStorageMeta(fileRecord.storage_meta, fileRecord.storage_config);

  if (sourceInstanceId === targetChannel) {
    return { status: 'skipped' };
  }

  const sourceEntry = storageManager.getStorageMeta(sourceInstanceId);
  if (!sourceEntry) {
    return { status: 'failed', reason: '源渠道不存在' };
  }

  const { stream, sourceChunkRecords } = await readSourceFileAsStream(fileRecord, storageManager);
  const fileSize = Number(fileRecord.size) || 0;

  const operationId = createStorageOperation(db, {
    operationType: 'migrate',
    fileId: fileRecord.id,
    sourceStorageId: sourceInstanceId,
    targetStorageId: targetChannel,
    payload: {
      sourceStorageId: sourceInstanceId,
      targetStorageId: targetChannel,
      previousStorageKey: fileRecord.storage_key,
      previousDeleteToken: sourceStorageMeta.deleteToken || null,
    },
  });

  // 判断是否需要分块（基于已知 fileSize，无需读入 buffer）
  const limits = storageManager.getEffectiveUploadLimits(targetChannel);
  const chunkAnalysis = ChunkManager.analyze(targetEntry.instance, fileSize, {
    channelConfig: limits.enableChunking ? {
      enableChunking: true,
      sizeLimitMB: limits.sizeLimitMB,
      chunkSizeMB: limits.chunkSizeMB,
      maxChunks: limits.maxChunks,
    } : null,
  });

  let targetUploadResult;

  if (chunkAnalysis.needsChunking) {
    // 分块场景：需要 buffer（各块尺寸有限，chunk-manager 内部逐块处理）
    const buffer = await streamToBuffer(stream);
    targetUploadResult = await uploadToStorage({
      storage: targetEntry.instance,
      buffer,
      fileId: fileRecord.id,
      newFileName: fileRecord.file_name,
      originalName: fileRecord.original_name,
      mimeType: fileRecord.mime_type,
      finalChannelId: targetChannel,
      storageManager,
    });
  } else {
    // 非分块场景：直接流式写入目标存储
    const storageResult = await targetEntry.instance.put(stream, {
      id: fileRecord.id,
      fileName: fileRecord.file_name,
      originalName: fileRecord.original_name,
      mimeType: fileRecord.mime_type,
      contentLength: fileSize || undefined,
    });
    targetUploadResult = {
      storageResult,
      isChunked: 0,
      chunkCount: 0,
      chunkRecords: [],
    };
  }

  markOperationRemoteDone(db, operationId, {
    sourceStorageId: sourceInstanceId,
    targetStorageId: targetChannel,
    remotePayload: {
      targetStorageId: targetChannel,
      targetStorageKey: targetUploadResult.storageResult.storageKey || fileRecord.file_name,
      deleteToken: targetUploadResult.storageResult.deleteToken || null,
      isChunked: Boolean(targetUploadResult.isChunked),
      chunkRecords: targetUploadResult.chunkRecords || [],
    },
  });

  const cleanupTargetPayload = {
    storageId: targetChannel,
    storageKey: targetUploadResult.storageResult.storageKey || fileRecord.file_name,
    deleteToken: targetUploadResult.storageResult.deleteToken || null,
    isChunked: Boolean(targetUploadResult.isChunked),
    chunkRecords: targetUploadResult.chunkRecords || [],
  };

  const sourceCleanupPayload = {
    storageId: sourceInstanceId,
    storageKey: fileRecord.storage_key,
    deleteToken: sourceStorageMeta.deleteToken || null,
    isChunked: Boolean(fileRecord.is_chunked),
    chunkRecords: sourceChunkRecords,
  };

  const persistMigration = db.transaction(() => {
    db.prepare('DELETE FROM chunks WHERE file_id = ?').run(fileRecord.id);
    ChunkManager.insertChunks(targetUploadResult.chunkRecords || [], db);

    updateFileMigrationFields(db, fileRecord.id, {
      storageChannel: targetEntry.type,
      storageKey: targetUploadResult.storageResult.storageKey || fileRecord.storage_key,
      storageMeta: serializeStorageMeta({ deleteToken: targetUploadResult.storageResult.deleteToken }),
      storageInstanceId: targetChannel,
      isChunked: targetUploadResult.isChunked ? 1 : 0,
      chunkCount: Number(targetUploadResult.chunkCount) || 0,
    });

    insertQuotaEvents(db, [
      buildQuotaEvent({
        operationId,
        fileId: fileRecord.id,
        storageId: sourceInstanceId,
        eventType: 'migrate_out',
        bytesDelta: -fileSize,
        fileCountDelta: -1,
      }),
      buildQuotaEvent({
        operationId,
        fileId: fileRecord.id,
        storageId: targetChannel,
        eventType: 'migrate_in',
        bytesDelta: fileSize,
        fileCountDelta: 1,
      }),
    ]);

    markOperationCommitted(db, operationId, {
      sourceStorageId: sourceInstanceId,
      targetStorageId: targetChannel,
      compensationPayload: sourceCleanupPayload,
    });
  });

  try {
    persistMigration();
  } catch (err) {
    markOperationCompensationPending(db, operationId, {
      sourceStorageId: sourceInstanceId,
      targetStorageId: targetChannel,
      compensationPayload: cleanupTargetPayload,
      error: err,
    });
    logger.warn(`[Files API] 迁移 ${fileRecord.id} 本地更新失败，目标端待补偿: ${err.message}`);
    throw err;
  }

  await storageManager.applyPendingQuotaEvents({ operationId, adjustUsageStats: true });

  try {
    await removeStoredArtifacts({
      storageManager,
      storageId: sourceCleanupPayload.storageId,
      storageKey: sourceCleanupPayload.storageKey,
      deleteToken: sourceCleanupPayload.deleteToken,
      isChunked: sourceCleanupPayload.isChunked,
      chunkRecords: sourceCleanupPayload.chunkRecords,
    });
    markOperationCompleted(db, operationId);
  } catch (cleanupErr) {
    markOperationCompensationPending(db, operationId, {
      sourceStorageId: sourceInstanceId,
      targetStorageId: targetChannel,
      compensationPayload: sourceCleanupPayload,
      error: cleanupErr,
    });
    logger.warn(`[Files API] 迁移 ${fileRecord.id} 已提交，但源端清理待补偿: ${cleanupErr.message}`);
    throw cleanupErr;
  }

  return { status: 'success' };
}

async function migrateFilesBatch(files, { targetChannel, db, storageManager, logger = log }) {
  const targetEntry = validateMigrationTarget(targetChannel, storageManager);
  const limit = pLimit(3);
  const results = {
    total: files.length,
    success: 0,
    failed: 0,
    skipped: 0,
    errors: [],
  };

  const tasks = files.map((fileRecord) =>
    limit(async () => {
      try {
        const result = await migrateFileRecord(fileRecord, {
          targetChannel,
          targetEntry,
          db,
          storageManager,
          logger,
        });

        return { fileRecord, result };
      } catch (err) {
        logger.error(`[Files API] 迁移文件 ${fileRecord.id} 失败:`, err.message);
        return { fileRecord, error: err };
      }
    })
  );

  const taskResults = await Promise.all(tasks);

  for (const item of taskResults) {
    if (item.error) {
      results.failed++;
      results.errors.push({ id: item.fileRecord.id, reason: item.error.message });
      continue;
    }

    if (item.result.status === 'success') {
      results.success++;
    } else if (item.result.status === 'skipped') {
      results.skipped++;
    } else {
      results.failed++;
      results.errors.push({ id: item.fileRecord.id, reason: item.result.reason || '迁移失败' });
    }
  }

  return results;
}

export { createFilesError,
  validateMigrationTarget,
  migrateFileRecord,
  migrateFilesBatch, };
