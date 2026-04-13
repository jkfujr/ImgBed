import express from 'express';
import crypto from 'crypto';
import multer from 'multer';
import storageManager from '../storage/manager.js';
import sharp from 'sharp';
import { sqlite } from '../database/index.js';
import { insertFile } from '../database/files-dao.js';
import { requirePermission } from '../middleware/auth.js';
import { guestUploadAuth } from '../middleware/guestUpload.js';
import { getLastKnownGoodConfig } from '../config/index.js';
import path from 'path';
import ChunkManager from '../storage/chunk-manager.js';
import { resolveUploadChannel } from '../services/upload/resolve-upload.js';
import { executeUploadWithFailover } from '../services/upload/execute-upload.js';
import {
  buildQuotaEvent,
  createStorageOperation,
  insertQuotaEvents,
  markOperationCommitted,
  markOperationCompensated,
  markOperationCompensationPending,
  markOperationCompleted,
  markOperationFailed,
  markOperationRemoteDone,
} from '../services/system/storage-operations.js';
import { removeStoredArtifacts } from '../services/files/storage-artifacts.js';
import asyncHandler from '../middleware/asyncHandler.js';
import { ValidationError, QuotaExceededError } from '../errors/AppError.js';
import { createLogger } from '../utils/logger.js';
import { cacheInvalidation } from '../middleware/cache.js';
import { ensureExistingDirectoryPath, normalizeDirectoryPath } from '../utils/directory-path.js';
import { success } from '../utils/response.js';

const log = createLogger('upload');
const uploadApp = express.Router();
const upload = multer({ storage: multer.memoryStorage() });
const ALLOWED_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.svg', '.bmp', '.ico'];

function validateUploadFile(file) {
  if (!file || typeof file === 'string') {
    throw new ValidationError('未检测到文件上传或字段错误');
  }
}

function normalizeUploadDirectory(input) {
  try {
    const normalized = normalizeDirectoryPath(input);
    ensureExistingDirectoryPath(normalized, sqlite);
    return normalized;
  } catch (error) {
    throw new ValidationError(`directory 参数不合法：${error.message}`);
  }
}

async function extractFileMetadata(file) {
  const buffer = file.buffer;
  const originalName = file.originalname || 'blob';
  const mimeType = file.mimetype || 'application/octet-stream';
  const rawExt = path.extname(originalName).toLowerCase();
  const mimeExt = mimeType ? `.${mimeType.split('/')[1]}`.replace('.jpeg', '.jpg') : '';
  const extension = rawExt || mimeExt || '';
  const isImageMime = mimeType.startsWith('image/');
  const isImageExt = ALLOWED_EXTENSIONS.includes(extension.toLowerCase());

  if (!isImageMime || !isImageExt) {
    throw new ValidationError(`非法文件格式: ${mimeType || '未知'} (${extension || '无后缀'})。本站仅支持图片托管。`);
  }

  let width = null;
  let height = null;
  let exif = null;
  try {
    const metadata = await sharp(buffer).metadata();
    width = metadata.width || null;
    height = metadata.height || null;
    const { format, size, width: metaWidth, height: metaHeight, space, channels, depth, density, hasProfile, hasAlpha, orientation, exif: rawExif } = metadata;
    exif = JSON.stringify({
      format,
      size,
      width: metaWidth,
      height: metaHeight,
      space,
      channels,
      depth,
      density,
      hasProfile,
      hasAlpha,
      orientation,
      hasExif: !!rawExif,
    });
  } catch (metaErr) {
    log.warn({ err: metaErr, filename: file.originalname }, '提取文件元数据失败');
  }

  const hash = crypto.createHash('sha1').update(buffer).digest('hex').substring(0, 12);
  const baseNameOnly = originalName.replace(/\.[^/.]+$/, '');
  const safeBaseName = baseNameOnly.replace(/[^a-zA-Z0-9]/g, '_').substring(0, 24);
  const fileId = `${hash}_${safeBaseName || 'file'}${extension}`;

  return {
    buffer,
    originalName,
    extension,
    fileId,
    newFileName: fileId,
    mimeType,
    width,
    height,
    exif,
  };
}

function buildUploadRecord({ fileId, newFileName, originalName, mimeType, fileSize, body, directory, finalChannelId, storageResult, isChunked, chunkCount, width, height, exif, auth, clientIp }) {
  const storageMeta = storageManager.getStorageMeta(finalChannelId);
  return {
    id: String(fileId),
    file_name: String(newFileName),
    original_name: String(originalName),
    mime_type: String(mimeType),
    size: Number(fileSize),
    storage_channel: String(storageMeta?.type || 'unknown'),
    storage_key: String(storageResult.id || newFileName),
    storage_config: JSON.stringify({
      extra_result: storageResult,
    }),
    storage_instance_id: String(finalChannelId),
    upload_ip: String(clientIp),
    upload_address: '{}',
    uploader_type: String(auth?.type || 'admin_jwt'),
    uploader_id: String(auth?.tokenId || auth?.username || 'admin'),
    directory,
    tags: body['tags'] ? JSON.stringify(body['tags'].toString().split(',')) : null,
    is_public: (body['is_public'] === 'true' || body['is_public'] === true || body['is_public'] === '1' || !!body['is_public']) ? 1 : 0,
    is_chunked: isChunked,
    chunk_count: chunkCount,
    width,
    height,
    exif,
    status: 'active',
  };
}

function resolveStoredFileSize(storageResult, fallbackSize) {
  const actualSize = Number(storageResult?.size);
  if (Number.isFinite(actualSize) && actualSize >= 0) {
    return actualSize;
  }

  const originalSize = Number(fallbackSize);
  return Number.isFinite(originalSize) ? originalSize : 0;
}

function buildUploadResponse({ fileId, newFileName, originalName, fileSize, width, height, finalChannelId, failedChannels }) {
  const responseData = {
    id: fileId,
    url: `/${fileId}`,
    file_name: newFileName,
    original_name: originalName,
    size: fileSize,
    width,
    height,
  };

  if (failedChannels.length > 0) {
    responseData.failover = {
      retries: failedChannels.length,
      failed: failedChannels.map((item) => item.id),
      final_channel: finalChannelId,
    };
  }

  const message = failedChannels.length > 0
    ? `文件上传成功（经过 ${failedChannels.length} 次渠道切换）`
    : '文件上传成功';

  return success(responseData, message);
}

/**
 * 文件上传接口
 * POST /api/upload
 */
uploadApp.post('/', guestUploadAuth, requirePermission('upload:image'), upload.single('file'), asyncHandler(async (req, res) => {
  const body = req.body || {};
  const file = req.file || null;

  validateUploadFile(file);

  const directory = normalizeUploadDirectory(body.directory);
  const config = getLastKnownGoodConfig();
  const { channelId } = resolveUploadChannel(body, storageManager, config);
  const quotaAllowed = storageManager.isUploadAllowed(channelId);
  if (!quotaAllowed) {
    throw new QuotaExceededError(`渠道 [${channelId}] 容量已达到停用阈值，已关闭上传功能`);
  }

  const fileMeta = await extractFileMetadata(file);
  const operationId = createStorageOperation(sqlite, {
    operationType: 'upload',
    fileId: fileMeta.fileId,
    targetStorageId: channelId,
    payload: { originalName: fileMeta.originalName },
  });

  const uploadResult = await executeUploadWithFailover({
    initialChannelId: channelId,
    buffer: fileMeta.buffer,
    fileId: fileMeta.fileId,
    newFileName: fileMeta.newFileName,
    originalName: fileMeta.originalName,
    mimeType: fileMeta.mimeType,
    storageManager,
    config,
  });

  markOperationRemoteDone(sqlite, operationId, {
    targetStorageId: uploadResult.finalChannelId,
    remotePayload: {
      storageId: uploadResult.finalChannelId,
      storageKey: uploadResult.storageResult.id || fileMeta.newFileName,
      isChunked: Boolean(uploadResult.isChunked),
      chunkRecords: uploadResult.chunkRecords || [],
    },
  });

  if (uploadResult.failedChannels.length > 0) {
    log.info({ fileId: fileMeta.fileId, retries: uploadResult.failedChannels.length, finalChannel: uploadResult.finalChannelId }, '上传故障切换：文件经过切换后成功上传');
  }

  const storedFileSize = resolveStoredFileSize(uploadResult.storageResult, file.size);

  const dbRecord = buildUploadRecord({
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
    auth: req.auth,
    clientIp: req.get('x-forwarded-for') || req.get('cf-connecting-ip') || req.ip || 'unknown',
  });

  const persistUpload = sqlite.transaction(() => {
    insertFile(sqlite, dbRecord);

    ChunkManager.insertChunks(uploadResult.chunkRecords || [], sqlite);
    insertQuotaEvents(sqlite, [buildQuotaEvent({
      operationId,
      fileId: fileMeta.fileId,
      storageId: uploadResult.finalChannelId,
      eventType: 'upload',
      bytesDelta: storedFileSize,
      fileCountDelta: 1,
      payload: { storageKey: dbRecord.storage_key },
    })]);
    markOperationCommitted(sqlite, operationId, { targetStorageId: uploadResult.finalChannelId });
  });

  // 保留补偿 try-catch: 数据库写入失败需要清理远端
  try {
    persistUpload();
  } catch (insertErr) {
    log.error({ err: insertErr, dbRecord }, '数据库写入失败');

    const cleanupPayload = {
      storageId: uploadResult.finalChannelId,
      storageKey: uploadResult.storageResult.id || fileMeta.newFileName,
      isChunked: Boolean(uploadResult.isChunked),
      chunkRecords: uploadResult.chunkRecords || [],
    };

    markOperationCompensationPending(sqlite, operationId, {
      targetStorageId: uploadResult.finalChannelId,
      compensationPayload: cleanupPayload,
      error: insertErr,
    });

    try {
      await removeStoredArtifacts({
        storageManager,
        storageId: cleanupPayload.storageId,
        storageKey: cleanupPayload.storageKey,
        isChunked: cleanupPayload.isChunked,
        chunkRecords: cleanupPayload.chunkRecords,
      });
      markOperationCompensated(sqlite, operationId, { compensationPayload: cleanupPayload });
    } catch (cleanupErr) {
      log.error({ err: cleanupErr }, '上传补偿失败');
      markOperationFailed(sqlite, operationId, cleanupErr);
    }

    throw insertErr;
  }

  await storageManager.applyPendingQuotaEvents({ operationId, adjustUsageStats: true });
  markOperationCompleted(sqlite, operationId);
  log.info({ fileId: fileMeta.fileId, channel: uploadResult.finalChannelId }, '文件上传成功');

  // 使文件列表和存储统计缓存失效
  cacheInvalidation.invalidateFiles();
  cacheInvalidation.invalidateStorages();

  return res.json(buildUploadResponse({
    fileId: fileMeta.fileId,
    newFileName: fileMeta.newFileName,
    originalName: fileMeta.originalName,
    fileSize: storedFileSize,
    width: fileMeta.width,
    height: fileMeta.height,
    finalChannelId: uploadResult.finalChannelId,
    failedChannels: uploadResult.failedChannels,
  }));
}));

export default uploadApp;
export { resolveStoredFileSize };
