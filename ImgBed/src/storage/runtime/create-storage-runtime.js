import { getLastKnownGoodConfig } from '../../config/index.js';
import { sqlite } from '../../database/index.js';
import { createLogger } from '../../utils/logger.js';
import { removeStoredArtifacts } from '../../services/files/storage-artifacts.js';
import { QuotaProjectionService } from '../quota/quota-projection-service.js';
import { StorageOperationRecovery } from '../recovery/storage-operation-recovery.js';
import { StorageMaintenanceScheduler } from './storage-maintenance-scheduler.js';
import { StoragePolicyService } from './storage-policy-service.js';
import { StorageRegistry } from './storage-registry.js';
import { StorageRuntime } from './storage-runtime.js';
import { StorageUploadAutoDisableService } from './storage-upload-auto-disable-service.js';
import { UploadSelector } from './upload-selector.js';

function createStorageRuntime({
  db = sqlite,
  logger = createLogger('storage'),
} = {}) {
  const config = getLastKnownGoodConfig();
  const registry = new StorageRegistry({
    db,
    logger,
    initialConfig: config.storage || {},
    initialUploadConfig: config.upload || {},
  });
  let autoDisableService = null;
  const disableExceededUploadChannels = async (storageIds = null) => {
    try {
      if (!autoDisableService) {
        return { disabledIds: [] };
      }
      return await autoDisableService.disableExceededUploadChannels(storageIds);
    } catch (err) {
      logger.error({ err, storageIds }, '容量阈值自动关闭上传失败');
      return { disabledIds: [] };
    }
  };
  const quotaProjectionService = new QuotaProjectionService({
    db,
    logger,
    onQuotaChanged: ({ storageIds }) => disableExceededUploadChannels(storageIds),
  });
  const storagePolicyService = new StoragePolicyService({
    registry,
    quotaProjectionService,
  });
  const uploadSelector = new UploadSelector({
    logger,
    getConfig: () => registry.getConfig(),
    getDefaultStorageId: () => registry.getDefaultStorageId(),
    listStorageEntries: () => registry.listEntries(),
    canUpload: (storageId) => storagePolicyService.isUploadAllowed(storageId),
    getUsageStats: () => quotaProjectionService.getUsageStatsMap(),
  });
  const recoveryService = new StorageOperationRecovery({
    db,
    logger,
    getStorage: (storageId) => registry.getStorage(storageId),
    applyPendingQuotaEvents: (options) => quotaProjectionService.applyPendingQuotaEvents(options),
    removeStoredArtifacts,
  });
  const maintenanceScheduler = new StorageMaintenanceScheduler({
    db,
    logger,
    getUploadConfig: () => registry.getUploadConfig(),
    verifyQuotaConsistency: () => quotaProjectionService.verifyQuotaConsistency(),
    rebuildQuotaStats: () => quotaProjectionService.rebuildAllQuotaStats(),
    recoverPendingOperations: (options) => recoveryService.recoverPendingOperations(options),
  });

  const runtime = new StorageRuntime({
    registry,
    quotaProjectionService,
    storagePolicyService,
    uploadSelector,
    recoveryService,
    maintenanceScheduler,
    disableExceededUploadChannels,
  });
  autoDisableService = new StorageUploadAutoDisableService({
    storageManager: {
      reload: () => registry.reload(),
    },
    quotaProjectionService,
    logger,
  });

  return {
    runtime,
    applyPendingQuotaEvents: (options = {}) => quotaProjectionService.applyPendingQuotaEvents(options),
  };
}

export {
  createStorageRuntime,
};
