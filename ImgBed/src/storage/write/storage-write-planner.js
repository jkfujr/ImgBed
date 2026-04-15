function createSizeLimitError(message) {
  const error = new Error(message);
  error.status = 413;
  error._sizeLimit = true;
  return error;
}

function buildChunkChannelConfig(limits) {
  if (!limits?.enableChunking) {
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

function analyzeChunkWrite(storage, fileSize, { channelConfig = null } = {}) {
  let config = storage.getChunkConfig();

  if (channelConfig && channelConfig.enableChunking) {
    config = {
      ...config,
      enabled: true,
      chunkThreshold: (channelConfig.sizeLimitMB || 10) * 1024 * 1024,
      chunkSize: (channelConfig.chunkSizeMB || 5) * 1024 * 1024,
      maxChunks: channelConfig.maxChunks > 0 ? channelConfig.maxChunks : (config.maxChunks || 1000),
    };
  }

  if (!config.enabled || fileSize <= config.chunkThreshold) {
    return {
      needsChunking: false,
      config: null,
      totalChunks: 0,
    };
  }

  const totalChunks = Math.ceil(fileSize / config.chunkSize);
  if (totalChunks > config.maxChunks) {
    const maxSize = ((config.chunkSize * config.maxChunks) / (1024 * 1024)).toFixed(0);
    throw createSizeLimitError(`文件过大，当前渠道最大支持 ${maxSize}MB`);
  }

  return {
    needsChunking: true,
    config,
    totalChunks,
  };
}

function planStorageWrite({
  storage,
  fileSize,
  storageId,
  storageType = null,
  storageManager,
} = {}) {
  const limits = storageManager.getEffectiveUploadLimits(storageId);
  assertFileSizeWithinLimits({ fileSize, limits });

  const resolvedStorageType = storageType || storageManager.getStorageMeta?.(storageId)?.type || null;
  const chunkAnalysis = analyzeChunkWrite(storage, fileSize, {
    channelConfig: buildChunkChannelConfig(limits),
  });

  if (!chunkAnalysis.needsChunking) {
    return {
      mode: 'direct',
      storageId,
      storageType: resolvedStorageType,
      fileSize,
      limits,
      chunkConfig: null,
    };
  }

  return {
    mode: chunkAnalysis.config?.mode === 'native' ? 'native' : 'chunked',
    storageId,
    storageType: resolvedStorageType,
    fileSize,
    limits,
    chunkConfig: chunkAnalysis.config,
  };
}

export {
  analyzeChunkWrite,
  assertFileSizeWithinLimits,
  buildChunkChannelConfig,
  createSizeLimitError,
  planStorageWrite,
};
