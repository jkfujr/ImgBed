import { getLastKnownGoodConfig } from '../../config/index.js';
import { sqlite } from '../../database/index.js';
import { insertFile } from '../../database/files-dao.js';
import { QuotaExceededError } from '../../errors/AppError.js';
import { cacheInvalidation } from '../../middleware/cache.js';
import { insertMany as insertChunkRecords } from '../../storage/chunks/chunk-record-repository.js';
import storageManager from '../../storage/manager.js';
import { applyPendingQuotaEvents as defaultApplyPendingQuotaEvents } from '../../storage/runtime/default-storage-runtime.js';
import { createLogger } from '../../utils/logger.js';
import { removeStoredArtifacts } from '../files/storage-artifacts.js';
import {
  buildStorageArtifactPayload,
  buildStoragePayloadFromStorageResult,
} from '../system/storage-operation-payload.js';
import { createStorageOperationLifecycle } from '../system/storage-operation-lifecycle.js';
import { buildQuotaEvent } from '../system/storage-operations.js';
import { executeUploadWithFailover } from './execute-upload.js';
import {
  normalizeUploadDirectory,
  prepareUploadFile,
  validateUploadFile,
} from './prepare-upload-file.js';
import { resolveUploadChannel } from './resolve-upload.js';
import {
  buildUploadRecord,
  buildUploadResponse,
  resolveStoredFileSize,
} from './upload-record.js';

function insertUploadChunks(records, db) {
  insertChunkRecords(records, db);
}

function createUploadApplicationService({
  db = sqlite,
  storageManager: storageManagerDep = storageManager,
  applyPendingQuotaEvents: applyPendingQuotaEventsDep = defaultApplyPendingQuotaEvents,
  getConfig = getLastKnownGoodConfig,
  resolveUploadChannel: resolveUploadChannelDep = resolveUploadChannel,
  validateUploadFile: validateUploadFileDep = validateUploadFile,
  normalizeUploadDirectory: normalizeUploadDirectoryDep = normalizeUploadDirectory,
  prepareUploadFile: prepareUploadFileDep = null,
  createStorageOperationLifecycle: createStorageOperationLifecycleDep = createStorageOperationLifecycle,
  executeUploadWithFailover: executeUploadWithFailoverDep = executeUploadWithFailover,
  buildStoragePayloadFromStorageResult: buildStoragePayloadFromStorageResultDep = buildStoragePayloadFromStorageResult,
  buildUploadRecord: buildUploadRecordDep = buildUploadRecord,
  resolveStoredFileSize: resolveStoredFileSizeDep = resolveStoredFileSize,
  buildUploadResponse: buildUploadResponseDep = buildUploadResponse,
  insertFile: insertFileDep = insertFile,
  insertChunks: insertChunksDep = insertUploadChunks,
  buildQuotaEvent: buildQuotaEventDep = buildQuotaEvent,
  buildStorageArtifactPayload: buildStorageArtifactPayloadDep = buildStorageArtifactPayload,
  removeStoredArtifacts: removeStoredArtifactsDep = removeStoredArtifacts,
  cacheInvalidation: cacheInvalidationDep = cacheInvalidation,
  logger = createLogger('upload'),
} = {}) {
  const prepareUploadFileFn = prepareUploadFileDep || ((file) => prepareUploadFile(file, { logger }));

  return {
    async handleUpload({
      body = {},
      file = null,
      auth = null,
      clientIp = 'unknown',
    } = {}) {
      validateUploadFileDep(file);

      const directory = normalizeUploadDirectoryDep(body.directory);
      const config = getConfig();
      const { channelId } = resolveUploadChannelDep(body, storageManagerDep, config);

      if (!storageManagerDep.isUploadAllowed(channelId)) {
        throw new QuotaExceededError(`渠道 [${channelId}] 容量已达到停用阈值，已关闭上传功能`);
      }

      const fileMeta = await prepareUploadFileFn(file);
      const lifecycle = createStorageOperationLifecycleDep({
        db,
        applyPendingQuotaEvents: applyPendingQuotaEventsDep,
        operationType: 'upload',
        fileId: fileMeta.fileId,
        targetStorageId: channelId,
        payload: { originalName: fileMeta.originalName },
      });
      const { operationId } = lifecycle;

      const uploadResult = await executeUploadWithFailoverDep({
        initialChannelId: channelId,
        buffer: fileMeta.buffer,
        fileId: fileMeta.fileId,
        newFileName: fileMeta.newFileName,
        originalName: fileMeta.originalName,
        mimeType: fileMeta.mimeType,
        storageManager: storageManagerDep,
        config,
      });

      const remotePayload = buildStoragePayloadFromStorageResultDep(uploadResult.storageResult, {
        isChunked: Boolean(uploadResult.isChunked),
        chunkRecords: uploadResult.chunkRecords || [],
      });

      lifecycle.markRemoteDone({
        targetStorageId: uploadResult.finalChannelId,
        remotePayload,
      });

      if (uploadResult.failedChannels.length > 0) {
        logger.info({
          fileId: fileMeta.fileId,
          retries: uploadResult.failedChannels.length,
          finalChannel: uploadResult.finalChannelId,
        }, '上传故障切换：文件经过切换后成功上传');
      }

      const storedFileSize = resolveStoredFileSizeDep(uploadResult.storageResult, file.size);
      const dbRecord = buildUploadRecordDep({
        storageManager: storageManagerDep,
        fileId: fileMeta.fileId,
        newFileName: fileMeta.newFileName,
        originalName: fileMeta.originalName,
        mimeType: fileMeta.mimeType,
        fileSize: storedFileSize,
        body,
        directory,
        finalChannelId: uploadResult.finalChannelId,
        storageResult: uploadResult.storageResult,
        isChunked: uploadResult.isChunked,
        chunkCount: uploadResult.chunkCount,
        width: fileMeta.width,
        height: fileMeta.height,
        exif: fileMeta.exif,
        auth,
        clientIp,
      });

      const quotaEvents = [buildQuotaEventDep({
        operationId,
        fileId: fileMeta.fileId,
        storageId: uploadResult.finalChannelId,
        eventType: 'upload',
        bytesDelta: storedFileSize,
        fileCountDelta: 1,
        payload: { storageKey: dbRecord.storage_key },
      })];

      const cleanupPayload = buildStorageArtifactPayloadDep({
        storageKey: uploadResult.storageResult.storageKey,
        deleteToken: uploadResult.storageResult.deleteToken || null,
        isChunked: Boolean(uploadResult.isChunked),
        chunkRecords: uploadResult.chunkRecords || [],
      });

      const persistUpload = () => {
        insertFileDep(db, dbRecord);
        insertChunksDep(uploadResult.chunkRecords || [], db);
      };

      try {
        await lifecycle.commit({
          persist: persistUpload,
          quotaEvents,
          targetStorageId: uploadResult.finalChannelId,
          committedCompensationPayload: null,
          failureCompensationPayload: cleanupPayload,
          executeCompensation: async () => {
            await removeStoredArtifactsDep({
              getStorage: (storageId) => storageManagerDep.getStorage(storageId),
              storageId: uploadResult.finalChannelId,
              storageKey: cleanupPayload.storageKey,
              deleteToken: cleanupPayload.deleteToken,
              isChunked: cleanupPayload.isChunked,
              chunkRecords: cleanupPayload.chunkRecords,
            });
          },
        });
      } catch (error) {
        logger.error({ err: error, dbRecord, operationId }, '上传提交流程失败');
        throw error;
      }

      logger.info({ fileId: fileMeta.fileId, channel: uploadResult.finalChannelId }, '文件上传成功');
      cacheInvalidationDep.invalidateFiles();
      cacheInvalidationDep.invalidateStorages();

      return buildUploadResponseDep({
        fileId: fileMeta.fileId,
        newFileName: fileMeta.newFileName,
        originalName: fileMeta.originalName,
        fileSize: storedFileSize,
        width: fileMeta.width,
        height: fileMeta.height,
        finalChannelId: uploadResult.finalChannelId,
        failedChannels: uploadResult.failedChannels,
      });
    },
  };
}

export { createUploadApplicationService };
