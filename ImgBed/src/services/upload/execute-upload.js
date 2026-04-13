import ChunkManager from '../../storage/chunk-manager.js';
import { createUploadError } from './resolve-upload.js';
import { createLogger } from '../../utils/logger.js';
import { createStoragePutResult } from '../../storage/contract.js';

const log = createLogger('execute-upload');

function isRetryableError(error) {
  const networkCodes = ['ETIMEDOUT', 'ECONNREFUSED', 'ENOTFOUND', 'ECONNRESET', 'EPIPE', 'EAI_AGAIN'];
  if (networkCodes.includes(error.code)) return true;

  const status = error.status || error.statusCode || error.response?.status;
  if (status && (status === 429 || status >= 500)) return true;

  const msg = (error.message || '').toLowerCase();
  if (msg.includes('timeout') || msg.includes('network') || msg.includes('unavailable')) return true;

  return false;
}

function isFailoverEligibleError(error) {
  if (!error || error._doNotFailover) {
    return false;
  }

  if (isRetryableError(error)) {
    return true;
  }

  const status = error.status || error.statusCode || error.response?.status;
  if (status === 400 || status === 401 || status === 403 || status === 404 || status === 409) {
    return true;
  }

  return !status;
}

async function uploadToStorage({ storage, buffer, fileId, newFileName, originalName, mimeType, finalChannelId, storageManager, config }) {
  const limits = storageManager.getEffectiveUploadLimits(finalChannelId);

  if (limits.enableMaxLimit) {
    const maxLimitBytes = limits.maxLimitMB * 1024 * 1024;
    if (buffer.length > maxLimitBytes) {
      const error = createUploadError(413, `文件体积超出最大限制 ${limits.maxLimitMB}MB`);
      error._sizeLimit = true;
      throw error;
    }
  }

  if (limits.enableSizeLimit) {
    const sizeLimitBytes = limits.sizeLimitMB * 1024 * 1024;
    if (buffer.length > sizeLimitBytes && !limits.enableChunking) {
      const error = createUploadError(413, `文件体积超出大小限制 ${limits.sizeLimitMB}MB`);
      error._sizeLimit = true;
      throw error;
    }
  }

  const chunkAnalysis = ChunkManager.analyze(storage, buffer.length, {
    channelConfig: limits.enableChunking ? {
      enableChunking: true,
      sizeLimitMB: limits.sizeLimitMB,
      chunkSizeMB: limits.chunkSizeMB,
      maxChunks: limits.maxChunks,
    } : null,
  });

  if (chunkAnalysis.needsChunking && chunkAnalysis.config.mode === 'native') {
    const storageResult = await ChunkManager.uploadS3Multipart(storage, buffer, {
      fileId,
      fileName: newFileName,
      originalName,
      mimeType,
      storageId: finalChannelId,
      config,
    });
    return {
      storageResult,
      isChunked: 0,
      chunkCount: 0,
      chunkRecords: [],
    };
  }

  if (chunkAnalysis.needsChunking) {
    const result = await ChunkManager.uploadChunked(storage, buffer, {
      fileId,
      fileName: newFileName,
      originalName,
      mimeType,
      storageId: finalChannelId,
    });
    return {
      storageResult: createStoragePutResult({
        storageKey: fileId,
        size: buffer.length,
      }),
      isChunked: 1,
      chunkCount: result.chunkCount,
      chunkRecords: result.chunkRecords,
    };
  }

  const storageResult = createStoragePutResult(await storage.put(buffer, {
    id: fileId,
    fileName: newFileName,
    originalName,
    mimeType,
  }));

  return {
    storageResult,
    isChunked: 0,
    chunkCount: 0,
    chunkRecords: [],
  };
}

async function executeUploadWithFailover({
  initialChannelId,
  buffer,
  fileId,
  newFileName,
  originalName,
  mimeType,
  storageManager,
  config,
}) {
  const failoverEnabled = config.storage?.failoverEnabled !== false;
  const lbActive = (config.storage?.loadBalanceStrategy || 'default') !== 'default';
  const maxRetries = 3;
  const failedChannels = [];
  let finalChannelId = initialChannelId;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const currentStorage = storageManager.getStorage(finalChannelId);
    if (!currentStorage) {
      failedChannels.push({ id: finalChannelId, error: '渠道实例不存在' });
      if (failoverEnabled && attempt < maxRetries) {
        const excludeIds = failedChannels.map((item) => item.id);
        const nextChannelId = storageManager.selectUploadChannel(null, excludeIds);
        if (nextChannelId) {
          log.info({ from: finalChannelId, to: nextChannelId }, '上传故障切换：渠道不存在，切换');
          finalChannelId = nextChannelId;
          continue;
        }
      }
      throw createUploadError(500, '找不到可用的存储渠道');
    }

    try {
      const uploadResult = await uploadToStorage({
        storage: currentStorage,
        buffer,
        fileId,
        newFileName,
        originalName,
        mimeType,
        finalChannelId,
        storageManager,
        config,
      });

      return {
        ...uploadResult,
        finalChannelId,
        failedChannels,
      };
    } catch (err) {
      log.warn({ channel: finalChannelId, err }, '上传故障切换：渠道上传失败');
      failedChannels.push({ id: finalChannelId, error: err.message });

      const canRetry = err._sizeLimit
        ? (failoverEnabled || lbActive)
        : (failoverEnabled && isFailoverEligibleError(err));

      if (!canRetry || attempt >= maxRetries) {
        if (err._sizeLimit) {
          err.status = 413;
          if (failedChannels.length > 1) {
            err.message += ` (已尝试 ${failedChannels.length} 个渠道)`;
          }
        } else if (!err.status) {
          err.status = 500;
          err.message = '底层文件流转储失败: ' + err.message
            + (failedChannels.length > 1 ? ` (已尝试 ${failedChannels.length} 个渠道)` : '');
        }
        throw err;
      }

      const excludeIds = failedChannels.map((item) => item.id);
      const nextChannelId = storageManager.selectUploadChannel(null, excludeIds);
      if (!nextChannelId) {
        throw createUploadError(500, '所有可用渠道均已尝试，上传失败');
      }

      log.info({ to: nextChannelId }, '上传故障切换：切换到备选渠道');
      finalChannelId = nextChannelId;
    }
  }

  throw createUploadError(500, '上传失败');
}

export { executeUploadWithFailover,
  isFailoverEligibleError,
  isRetryableError,
  uploadToStorage, };
