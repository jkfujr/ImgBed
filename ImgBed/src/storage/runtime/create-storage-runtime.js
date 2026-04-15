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
  const quotaProjectionService = new QuotaProjectionService({
    db,
    logger,
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
  });

  return {
    runtime,
    applyPendingQuotaEvents: (options = {}) => quotaProjectionService.applyPendingQuotaEvents(options),
  };
}

export {
  createStorageRuntime,
};
