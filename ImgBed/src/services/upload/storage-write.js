import ChunkManager from '../../storage/chunk-manager.js';
import { createStoragePutResult } from '../../storage/contract.js';
import { createUploadError } from './resolve-upload.js';

function createSizeLimitError(message) {
  const error = createUploadError(413, message);
  error._sizeLimit = true;
  return error;
}

function buildChunkChannelConfig(limits) {
  if (!limits.enableChunking) {
    return null;
  }

  return {
    enableChunking: true,
    sizeLimitMB: limits.sizeLimitMB,
    chunkSizeMB: limits.chunkSizeMB,
    maxChunks: limits.maxChunks,
  };
}

function assertFileSizeWithinLimits({ fileSize, limits }) {
  if (limits.enableMaxLimit) {
    const maxLimitBytes = limits.maxLimitMB * 1024 * 1024;
    if (fileSize > maxLimitBytes) {
      throw createSizeLimitError(`文件体积超出最大限制 ${limits.maxLimitMB}MB`);
    }
  }

  if (limits.enableSizeLimit) {
    const sizeLimitBytes = limits.sizeLimitMB * 1024 * 1024;
    if (fileSize > sizeLimitBytes && !limits.enableChunking) {
      throw createSizeLimitError(`文件体积超出大小限制 ${limits.sizeLimitMB}MB`);
    }
  }
}

function resolveStorageWritePlan({
  storage,
  fileSize,
  storageId,
  storageManager,
  ChunkManager: chunkManager = ChunkManager,
} = {}) {
  const limits = storageManager.getEffectiveUploadLimits(storageId);
  assertFileSizeWithinLimits({ fileSize, limits });

  const chunkAnalysis = chunkManager.analyze(storage, fileSize, {
    channelConfig: buildChunkChannelConfig(limits),
  });

  if (!chunkAnalysis.needsChunking) {
    return {
      mode: 'direct',
      storageId,
      fileSize,
      limits,
      chunkAnalysis,
    };
  }

  return {
    mode: chunkAnalysis.config?.mode === 'native' ? 'native' : 'chunked',
    storageId,
    fileSize,
    limits,
    chunkAnalysis,
  };
}

async function executePlannedBufferWrite({
  plan,
  storage,
  buffer,
  fileId,
  newFileName,
  originalName,
  mimeType,
  config,
  ChunkManager: chunkManager = ChunkManager,
} = {}) {
  if (plan.mode === 'native') {
    const storageResult = await chunkManager.uploadS3Multipart(storage, buffer, {
      fileId,
      fileName: newFileName,
      originalName,
      mimeType,
      storageId: plan.storageId,
      config,
    });

    return {
      storageResult,
      isChunked: 0,
      chunkCount: 0,
      chunkRecords: [],
    };
  }

  if (plan.mode === 'chunked') {
    const result = await chunkManager.uploadChunked(storage, buffer, {
      fileId,
      fileName: newFileName,
      originalName,
      mimeType,
      storageId: plan.storageId,
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

export {
  executePlannedBufferWrite,
  resolveStorageWritePlan,
};
