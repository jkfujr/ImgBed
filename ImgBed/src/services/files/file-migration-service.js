import pLimit from 'p-limit';

import ChunkManager from '../../storage/chunk-manager.js';
import { toBuffer, toNodeReadable } from '../../utils/storage-io.js';
import { createLogger } from '../../utils/logger.js';
import {
  buildStorageArtifactPayload,
  buildStoragePayloadFromStorageResult,
} from '../system/storage-operation-payload.js';
import { createStorageOperationLifecycle } from '../system/storage-operation-lifecycle.js';
import { buildQuotaEvent } from '../system/storage-operations.js';
import {
  executePlannedBufferWrite,
  resolveStorageWritePlan,
} from '../upload/storage-write.js';
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

function createFileMigrationService({
  db,
  storageManager,
  ChunkManager: chunkManager = ChunkManager,
  logger = log,
  toBufferFn = toBuffer,
  toNodeReadableFn = toNodeReadable,
  resolveStorageWritePlanFn = resolveStorageWritePlan,
  executePlannedBufferWriteFn = executePlannedBufferWrite,
  buildQuotaEventFn = buildQuotaEvent,
  buildStorageArtifactPayloadFn = buildStorageArtifactPayload,
  buildStoragePayloadFromStorageResultFn = buildStoragePayloadFromStorageResult,
  createStorageOperationLifecycleFn = createStorageOperationLifecycle,
  parseStorageMetaFn = parseStorageMeta,
  removeStoredArtifactsFn = removeStoredArtifacts,
  resolveStorageInstanceIdFn = resolveStorageInstanceId,
  serializeStorageMetaFn = serializeStorageMeta,
  updateFileMigrationFieldsFn = updateFileMigrationFields,
} = {}) {
  if (!db) {
    throw new Error('创建文件迁移服务时缺少数据库实例');
  }

  if (!storageManager) {
    throw new Error('创建文件迁移服务时缺少 storageManager');
  }

  async function prepareMigrationSource(fileRecord, sourceEntry) {
    const sourceInstanceId = resolveStorageInstanceIdFn(fileRecord);
    const sourceStorageMeta = parseStorageMetaFn(fileRecord.storage_meta);
    const fileSize = Number(fileRecord.size) || 0;
    let sourceChunkRecords = [];
    let stream = null;

    if (fileRecord.is_chunked) {
      sourceChunkRecords = await chunkManager.getChunks(fileRecord.id);
      stream = chunkManager.createChunkedReadStream(
        sourceChunkRecords,
        (storageId) => storageManager.getStorage(storageId),
        { totalSize: fileSize },
      );
    } else {
      const readResult = await sourceEntry.instance.getStreamResponse(fileRecord.storage_key);
      stream = toNodeReadableFn(readResult.stream);
    }

    return {
      fileSize,
      sourceInstanceId,
      sourceChunkRecords,
      sourceCleanupPayload: buildStorageArtifactPayloadFn({
        storageKey: fileRecord.storage_key,
        deleteToken: sourceStorageMeta.deleteToken || null,
        isChunked: Boolean(fileRecord.is_chunked),
        chunkRecords: sourceChunkRecords,
      }),
      stream,
    };
  }

  async function writeTargetStorage({
    fileRecord,
    stream,
    fileSize,
    targetChannel,
    targetEntry,
  } = {}) {
    const writePlan = resolveStorageWritePlanFn({
      storage: targetEntry.instance,
      fileSize,
      storageId: targetChannel,
      storageManager,
      ChunkManager: chunkManager,
    });

    if (writePlan.mode === 'direct') {
      const storageResult = await targetEntry.instance.put(stream, {
        id: fileRecord.id,
        fileName: fileRecord.file_name,
        originalName: fileRecord.original_name,
        mimeType: fileRecord.mime_type,
        contentLength: fileSize || undefined,
      });

      return {
        storageResult,
        isChunked: 0,
        chunkCount: 0,
        chunkRecords: [],
      };
    }

    const buffer = await toBufferFn(stream);
    return executePlannedBufferWriteFn({
      plan: writePlan,
      storage: targetEntry.instance,
      buffer,
      fileId: fileRecord.id,
      newFileName: fileRecord.file_name,
      originalName: fileRecord.original_name,
      mimeType: fileRecord.mime_type,
      ChunkManager: chunkManager,
    });
  }

  function persistMigration({
    fileRecord,
    targetChannel,
    targetEntry,
    targetUploadResult,
  } = {}) {
    db.prepare('DELETE FROM chunks WHERE file_id = ?').run(fileRecord.id);
    chunkManager.insertChunks(targetUploadResult.chunkRecords || [], db);

    updateFileMigrationFieldsFn(db, fileRecord.id, {
      storageChannel: targetEntry.type,
      storageKey: targetUploadResult.storageResult.storageKey,
      storageMeta: serializeStorageMetaFn({ deleteToken: targetUploadResult.storageResult.deleteToken }),
      storageInstanceId: targetChannel,
      isChunked: targetUploadResult.isChunked ? 1 : 0,
      chunkCount: Number(targetUploadResult.chunkCount) || 0,
    });
  }

  function buildMigrationQuotaEvents({
    operationId,
    fileRecord,
    fileSize,
    sourceInstanceId,
    targetChannel,
  } = {}) {
    return [
      buildQuotaEventFn({
        operationId,
        fileId: fileRecord.id,
        storageId: sourceInstanceId,
        eventType: 'migrate_out',
        bytesDelta: -fileSize,
        fileCountDelta: -1,
      }),
      buildQuotaEventFn({
        operationId,
        fileId: fileRecord.id,
        storageId: targetChannel,
        eventType: 'migrate_in',
        bytesDelta: fileSize,
        fileCountDelta: 1,
      }),
    ];
  }

  async function migrateFileRecord(fileRecord, {
    targetChannel,
    targetEntry = validateMigrationTarget(targetChannel, storageManager),
  } = {}) {
    const sourceInstanceId = resolveStorageInstanceIdFn(fileRecord);

    if (sourceInstanceId === targetChannel) {
      return { status: 'skipped' };
    }

    const sourceEntry = storageManager.getStorageMeta(sourceInstanceId);
    if (!sourceEntry) {
      return { status: 'failed', reason: '源渠道不存在' };
    }

    const sourceContext = await prepareMigrationSource(fileRecord, sourceEntry);
    const lifecycle = createStorageOperationLifecycleFn({
      db,
      storageManager,
      operationType: 'migrate',
      fileId: fileRecord.id,
      sourceStorageId: sourceContext.sourceInstanceId,
      targetStorageId: targetChannel,
      payload: sourceContext.sourceCleanupPayload,
    });
    const { operationId } = lifecycle;

    const targetUploadResult = await writeTargetStorage({
      fileRecord,
      stream: sourceContext.stream,
      fileSize: sourceContext.fileSize,
      targetChannel,
      targetEntry,
    });

    const targetCleanupPayload = buildStoragePayloadFromStorageResultFn(targetUploadResult.storageResult, {
      isChunked: Boolean(targetUploadResult.isChunked),
      chunkRecords: targetUploadResult.chunkRecords || [],
    });

    lifecycle.markRemoteDone({
      sourceStorageId: sourceContext.sourceInstanceId,
      targetStorageId: targetChannel,
      remotePayload: targetCleanupPayload,
    });

    try {
      await lifecycle.commit({
        persist: () => persistMigration({
          fileRecord,
          targetChannel,
          targetEntry,
          targetUploadResult,
        }),
        quotaEvents: buildMigrationQuotaEvents({
          operationId,
          fileRecord,
          fileSize: sourceContext.fileSize,
          sourceInstanceId: sourceContext.sourceInstanceId,
          targetChannel,
        }),
        sourceStorageId: sourceContext.sourceInstanceId,
        targetStorageId: targetChannel,
        committedCompensationPayload: sourceContext.sourceCleanupPayload,
        failureCompensationPayload: targetCleanupPayload,
        executeCompensation: async () => {
          await removeStoredArtifactsFn({
            storageManager,
            storageId: targetChannel,
            storageKey: targetCleanupPayload.storageKey,
            deleteToken: targetCleanupPayload.deleteToken,
            isChunked: targetCleanupPayload.isChunked,
            chunkRecords: targetCleanupPayload.chunkRecords,
          });
        },
        afterCommit: async () => {
          await removeStoredArtifactsFn({
            storageManager,
            storageId: sourceContext.sourceInstanceId,
            storageKey: sourceContext.sourceCleanupPayload.storageKey,
            deleteToken: sourceContext.sourceCleanupPayload.deleteToken,
            isChunked: sourceContext.sourceCleanupPayload.isChunked,
            chunkRecords: sourceContext.sourceCleanupPayload.chunkRecords,
          });
        },
      });
    } catch (error) {
      if (error?.message) {
        logger.warn(`[Files API] 迁移 ${fileRecord.id} 处理失败: ${error.message}`);
      }
      throw error;
    }

    return { status: 'success' };
  }

  async function migrateFilesBatch(files, { targetChannel } = {}) {
    const targetEntry = validateMigrationTarget(targetChannel, storageManager);
    const limit = pLimit(3);
    const results = {
      total: files.length,
      success: 0,
      failed: 0,
      skipped: 0,
      errors: [],
    };

    const taskResults = await Promise.all(files.map((fileRecord) => limit(async () => {
      try {
        const result = await migrateFileRecord(fileRecord, {
          targetChannel,
          targetEntry,
        });
        return { fileRecord, result };
      } catch (error) {
        logger.error(`[Files API] 迁移文件 ${fileRecord.id} 失败:`, error.message);
        return { fileRecord, error };
      }
    })));

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

  return {
    migrateFileRecord,
    migrateFilesBatch,
  };
}

export {
  createFileMigrationService,
  createFilesError,
  validateMigrationTarget,
};
