import { isQuotaThresholdReached } from './quota-threshold.js';

class StoragePolicyService {
  constructor({
    registry,
    quotaProjectionService,
  } = {}) {
    this.registry = registry;
    this.quotaProjectionService = quotaProjectionService;
  }

  isQuotaExceeded(storageId) {
    const entry = this.registry.getStorageMeta(storageId);
    if (!entry) {
      return true;
    }

    const usedBytes = this.quotaProjectionService.getUsedBytes(storageId);
    return isQuotaThresholdReached(entry, usedBytes);
  }

  isUploadAllowed(storageId) {
    const entry = this.registry.getStorageMeta(storageId);
    if (!entry) {
      return false;
    }

    const storageConfig = this.registry.getConfig();
    const isWhitelisted = Array.isArray(storageConfig.allowedUploadChannels)
      ? storageConfig.allowedUploadChannels.includes(storageId)
      : true;

    return Boolean(entry.allowUpload) && isWhitelisted && !this.isQuotaExceeded(storageId);
  }

  getEffectiveUploadLimits(storageId) {
    const entry = this.registry.getStorageMeta(storageId);
    const uploadConfig = this.registry.getUploadConfig() || {};

    if (entry && entry.enableSizeLimit) {
      return {
        enableSizeLimit: true,
        sizeLimitMB: entry.sizeLimitMB || uploadConfig.defaultSizeLimitMB || 10,
        enableChunking: Boolean(entry.enableChunking),
        chunkSizeMB: entry.chunkSizeMB || uploadConfig.defaultChunkSizeMB || 5,
        maxChunks: entry.maxChunks ?? uploadConfig.defaultMaxChunks ?? 0,
        enableMaxLimit: Boolean(entry.enableMaxLimit),
        maxLimitMB: entry.maxLimitMB || uploadConfig.defaultMaxLimitMB || 100,
      };
    }

    if (uploadConfig.enableSizeLimit) {
      return {
        enableSizeLimit: true,
        sizeLimitMB: uploadConfig.defaultSizeLimitMB || 10,
        enableChunking: Boolean(uploadConfig.enableChunking),
        chunkSizeMB: uploadConfig.defaultChunkSizeMB || 5,
        maxChunks: uploadConfig.defaultMaxChunks ?? 0,
        enableMaxLimit: Boolean(uploadConfig.enableMaxLimit),
        maxLimitMB: uploadConfig.defaultMaxLimitMB || 100,
      };
    }

    return {
      enableSizeLimit: false,
      sizeLimitMB: 10,
      enableChunking: false,
      chunkSizeMB: 5,
      maxChunks: 0,
      enableMaxLimit: false,
      maxLimitMB: 100,
    };
  }
}

export {
  StoragePolicyService,
};
