import { readRuntimeConfig } from '../../config/index.js';
import { invalidateStorageCaches as defaultInvalidateStorageCaches } from '../../services/cache/cache-invalidation-service.js';
import { applyStorageConfigChange as defaultApplyStorageConfigChange } from '../../services/system/apply-storage-config.js';
import { createLogger } from '../../utils/logger.js';
import { isQuotaThresholdReached } from './quota-threshold.js';

const log = createLogger('storage');

class StorageUploadAutoDisableService {
  constructor({
    readRuntimeConfig: readRuntimeConfigDep = readRuntimeConfig,
    applyStorageConfigChange = defaultApplyStorageConfigChange,
    storageManager = { reload: async () => {} },
    quotaProjectionService,
    invalidateStorageCaches = defaultInvalidateStorageCaches,
    logger = log,
  } = {}) {
    this.readRuntimeConfig = readRuntimeConfigDep;
    this.applyStorageConfigChange = applyStorageConfigChange;
    this.storageManager = storageManager;
    this.quotaProjectionService = quotaProjectionService;
    this.invalidateStorageCaches = invalidateStorageCaches;
    this.log = logger;
  }

  async disableExceededUploadChannels(storageIds = null) {
    const cfg = this.readRuntimeConfig();
    const storages = Array.isArray(cfg.storage?.storages) ? cfg.storage.storages : [];
    const filterIds = Array.isArray(storageIds) && storageIds.length > 0
      ? new Set(storageIds)
      : null;
    const disabledIds = [];

    for (const storage of storages) {
      if (!storage?.id || (filterIds && !filterIds.has(storage.id))) {
        continue;
      }

      if (!storage.enabled || !storage.allowUpload) {
        continue;
      }

      const usedBytes = this.quotaProjectionService.getUsedBytes(storage.id);
      if (isQuotaThresholdReached(storage, usedBytes)) {
        storage.allowUpload = false;
        disabledIds.push(storage.id);
      }
    }

    if (disabledIds.length === 0) {
      return { disabledIds: [] };
    }

    await this.applyStorageConfigChange({
      cfg,
      storageManager: this.storageManager,
    });
    this.invalidateCaches(disabledIds);
    this.log.warn({ storageIds: disabledIds }, '容量达到停用阈值，已自动关闭渠道上传');

    return { disabledIds };
  }

  invalidateCaches(disabledIds) {
    try {
      this.invalidateStorageCaches();
    } catch (error) {
      this.log.warn({ err: error, storageIds: disabledIds }, '自动关闭上传后刷新缓存失败');
    }
  }
}

export { StorageUploadAutoDisableService };
