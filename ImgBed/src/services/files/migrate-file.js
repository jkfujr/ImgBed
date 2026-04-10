import pLimit from 'p-limit';
import { Readable } from 'stream';
import { createLogger } from '../../utils/logger.js';
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
import { parseStorageConfig, removeStoredArtifacts } from './storage-artifacts.js';
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

  const targetEntry = storageManager.instances.get(targetChannel);
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

async function streamToBuffer(stream) {
  if (Buffer.isBuffer(stream)) {
    return stream;
  }

  if (stream instanceof Readable) {
    const chunks = [];
    for await (const chunk of stream) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    return Buffer.concat(chunks);
  }

  const reader = stream.getReader();
  const chunks = [];
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(Buffer.from(value));
  }
  return Buffer.concat(chunks);
}

async function readSourceFile(fileRecord, storageManager) {
  const sourceConfig = parseStorageConfig(fileRecord.storage_config);
  const sourceInstanceId = fileRecord.storage_instance_id || sourceConfig.instance_id;

  if (!sourceInstanceId) {
    throw new Error('源文件缺少 storage_instance_id');
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
      buffer: await streamToBuffer(stream),
    };
  }

  const sourceEntry = storageManager.instances.get(sourceInstanceId);
  if (!sourceEntry) {
    throw new Error('源渠道不存在');
  }

  const fileStream = await sourceEntry.instance.getStream(fileRecord.storage_key);
  return {
    sourceInstanceId,
    sourceChunkRecords: [],
    buffer: await streamToBuffer(fileStream),
  };
}

async function migrateFileRecord(fileRecord, { targetChannel, targetEntry, db, storageManager, logger = log }) {
  const sourceConfig = parseStorageConfig(fileRecord.storage_config);
  const sourceInstanceId = fileRecord.storage_instance_id || sourceConfig.instance_id;

  if (sourceInstanceId === targetChannel) {
    return { status: 'skipped' };
  }

  const sourceEntry = storageManager.instances.get(sourceInstanceId);
  if (!sourceEntry) {
    return { status: 'failed', reason: '源渠道不存在' };
  }

  const { buffer, sourceChunkRecords } = await readSourceFile(fileRecord, storageManager);
  const operationId = createStorageOperation(db, {
    operationType: 'migrate',
    fileId: fileRecord.id,
    sourceStorageId: sourceInstanceId,
    targetStorageId: targetChannel,
    payload: {
      sourceStorageId: sourceInstanceId,
      targetStorageId: targetChannel,
      previousStorageKey: fileRecord.storage_key,
    },
  });

  const targetUploadResult = await uploadToStorage({
    storage: targetEntry.instance,
    buffer,
    fileId: fileRecord.id,
    newFileName: fileRecord.file_name,
    originalName: fileRecord.original_name,
    mimeType: fileRecord.mime_type,
    finalChannelId: targetChannel,
    storageManager,
  });

  markOperationRemoteDone(db, operationId, {
    sourceStorageId: sourceInstanceId,
    targetStorageId: targetChannel,
    remotePayload: {
      targetStorageId: targetChannel,
      targetStorageKey: targetUploadResult.storageResult.id || fileRecord.file_name,
      isChunked: Boolean(targetUploadResult.isChunked),
      chunkRecords: targetUploadResult.chunkRecords || [],
    },
  });

  const cleanupTargetPayload = {
    storageId: targetChannel,
    storageKey: targetUploadResult.storageResult.id || fileRecord.file_name,
    isChunked: Boolean(targetUploadResult.isChunked),
    chunkRecords: targetUploadResult.chunkRecords || [],
  };

  const sourceCleanupPayload = {
    storageId: sourceInstanceId,
    storageKey: fileRecord.storage_key,
    isChunked: Boolean(fileRecord.is_chunked),
    chunkRecords: sourceChunkRecords,
  };

  const persistMigration = db.transaction(() => {
    db.prepare('DELETE FROM chunks WHERE file_id = ?').run(fileRecord.id);
    ChunkManager.insertChunks(targetUploadResult.chunkRecords || [], db);

    updateFileMigrationFields(db, fileRecord.id, {
      storageChannel: targetEntry.type,
      storageKey: targetUploadResult.storageResult.id || fileRecord.storage_key,
      storageConfig: JSON.stringify({
        extra_result: targetUploadResult.storageResult,
      }),
      storageInstanceId: targetChannel,
      isChunked: targetUploadResult.isChunked ? 1 : 0,
      chunkCount: Number(targetUploadResult.chunkCount) || 0,
    });

    const fileSize = Number(fileRecord.size) || 0;
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
