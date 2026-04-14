import ChunkManager from '../../storage/chunk-manager.js';
import { createStoragePutResult } from '../../storage/contract.js';
import { createLogger } from '../../utils/logger.js';
import { createUploadError } from './resolve-upload.js';

const log = createLogger('execute-upload');
const MAX_RETRIES = 3;

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

function createSizeLimitError(message) {
  const error = createUploadError(413, message);
  error._sizeLimit = true;
  return error;
}

function assertUploadWithinLimits({ buffer, limits }) {
  if (limits.enableMaxLimit) {
    const maxLimitBytes = limits.maxLimitMB * 1024 * 1024;
    if (buffer.length > maxLimitBytes) {
      throw createSizeLimitError(`文件体积超出最大限制 ${limits.maxLimitMB}MB`);
    }
  }

  if (limits.enableSizeLimit) {
    const sizeLimitBytes = limits.sizeLimitMB * 1024 * 1024;
    if (buffer.length > sizeLimitBytes && !limits.enableChunking) {
      throw createSizeLimitError(`文件体积超出大小限制 ${limits.sizeLimitMB}MB`);
    }
  }
}

function analyzeChunkingPlan({ storage, bufferLength, limits }) {
  return ChunkManager.analyze(storage, bufferLength, {
    channelConfig: limits.enableChunking ? {
      enableChunking: true,
      sizeLimitMB: limits.sizeLimitMB,
      chunkSizeMB: limits.chunkSizeMB,
      maxChunks: limits.maxChunks,
    } : null,
  });
}

async function executeStorageWrite({
  storage,
  buffer,
  fileId,
  newFileName,
  originalName,
  mimeType,
  finalChannelId,
  config,
  limits,
}) {
  const chunkAnalysis = analyzeChunkingPlan({
    storage,
    bufferLength: buffer.length,
    limits,
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

async function uploadToStorage({
  storage,
  buffer,
  fileId,
  newFileName,
  originalName,
  mimeType,
  finalChannelId,
  storageManager,
  config,
}) {
  const limits = storageManager.getEffectiveUploadLimits(finalChannelId);
  assertUploadWithinLimits({ buffer, limits });

  return executeStorageWrite({
    storage,
    buffer,
    fileId,
    newFileName,
    originalName,
    mimeType,
    finalChannelId,
    config,
    limits,
  });
}

function canFailoverAfterError({
  error,
  failoverEnabled,
  loadBalanceActive,
}) {
  if (error?._sizeLimit) {
    return failoverEnabled || loadBalanceActive;
  }

  return failoverEnabled && isFailoverEligibleError(error);
}

function formatTerminalUploadError(error, failedChannels) {
  if (error._sizeLimit) {
    error.status = 413;
    if (failedChannels.length > 1) {
      error.message += ` (已尝试 ${failedChannels.length} 个渠道)`;
    }
    return error;
  }

  if (!error.status) {
    error.status = 500;
    error.message = '底层文件流转储失败: ' + error.message
      + (failedChannels.length > 1 ? ` (已尝试 ${failedChannels.length} 个渠道)` : '');
  }

  return error;
}

function selectNextUploadChannel(storageManager, failedChannels) {
  const excludeIds = failedChannels.map((item) => item.id);
  return storageManager.selectUploadChannel(null, excludeIds);
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
  const loadBalanceActive = (config.storage?.loadBalanceStrategy || 'default') !== 'default';
  const failedChannels = [];
  let finalChannelId = initialChannelId;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    const currentStorage = storageManager.getStorage(finalChannelId);

    if (!currentStorage) {
      failedChannels.push({ id: finalChannelId, error: '渠道实例不存在' });
      if (failoverEnabled && attempt < MAX_RETRIES) {
        const nextChannelId = selectNextUploadChannel(storageManager, failedChannels);
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

      const canRetry = canFailoverAfterError({
        error: err,
        failoverEnabled,
        loadBalanceActive,
      });

      if (!canRetry || attempt >= MAX_RETRIES) {
        throw formatTerminalUploadError(err, failedChannels);
      }

      const nextChannelId = selectNextUploadChannel(storageManager, failedChannels);
      if (!nextChannelId) {
        throw createUploadError(500, '所有可用渠道均已尝试，上传失败');
      }

      log.info({ to: nextChannelId }, '上传故障切换：切换到备选渠道');
      finalChannelId = nextChannelId;
    }
  }

  throw createUploadError(500, '上传失败');
}

export {
  executeUploadWithFailover,
  isFailoverEligibleError,
  isRetryableError,
  uploadToStorage,
};
