import { getLastKnownGoodConfig } from '../config/index.js';
import { sqlite } from '../database/index.js';
import { createLogger } from '../utils/logger.js';

import { QuotaProjectionService } from './quota/quota-projection-service.js';
import { StorageOperationRecovery } from './recovery/storage-operation-recovery.js';
import { StorageMaintenanceScheduler } from './runtime/storage-maintenance-scheduler.js';
import { StorageRegistry } from './runtime/storage-registry.js';
import { UploadSelector } from './runtime/upload-selector.js';

const log = createLogger('storage');

class StorageManager {
  constructor({ db = sqlite } = {}) {
    const config = getLastKnownGoodConfig();
    this.db = db;
    this.registry = new StorageRegistry({
      db: this.db,
      logger: log,
      initialConfig: config.storage || {},
      initialUploadConfig: config.upload || {},
    });
    this.quotaProjectionService = new QuotaProjectionService({
      db: this.db,
      logger: log,
    });
    this.uploadSelector = new UploadSelector({
      logger: log,
      getConfig: () => this.registry.getConfig(),
      getDefaultStorageId: () => this.registry.getDefaultStorageId(),
      listStorageEntries: () => this.registry.listEntries(),
      isUploadAllowed: (storageId) => this.isUploadAllowed(storageId),
      getUsageStats: () => this.quotaProjectionService.getUsageStatsMap(),
    });
    this.recoveryService = new StorageOperationRecovery({
      db: this.db,
      logger: log,
      storageManager: this,
      applyPendingQuotaEvents: (options) => this.applyPendingQuotaEvents(options),
    });
    this.maintenanceScheduler = new StorageMaintenanceScheduler({
      db: this.db,
      logger: log,
      getUploadConfig: () => this.registry.getUploadConfig(),
      verifyQuotaConsistency: () => this.verifyQuotaConsistency(),
      rebuildQuotaStats: () => this.rebuildQuotaStats(),
      recoverPendingOperations: () => this.recoverPendingOperations(),
    });
    this._initializePromise = null;
    this._isInitialized = false;
  }

  async initialize() {
    if (this._isInitialized) {
      return;
    }

    if (this._initializePromise) {
      return this._initializePromise;
    }

    this._initializePromise = (async () => {
      await this.reload();
      await this.quotaProjectionService.loadQuotaFromCache();
      await this.quotaProjectionService.initUsageStats();
      await this.applyPendingQuotaEvents({ adjustUsageStats: false, recordSnapshots: true });

      const consistency = await this.verifyQuotaConsistency().catch((err) => {
        log.warn({ err }, '初始化容量一致性校验失败，开始重建容量投影');
        return { consistent: false };
      });

      if (!consistency.consistent) {
        await this.rebuildQuotaStats();
      }

      await this.recoverPendingOperations();
      this._isInitialized = true;
    })();

    try {
      await this._initializePromise;
    } catch (err) {
      this._initializePromise = null;
      throw err;
    }

    this._initializePromise = null;
  }

  async startMaintenance() {
    await this.initialize();
    await this.maintenanceScheduler.start();
  }

  stopMaintenance() {
    this.maintenanceScheduler.stop();
  }

  async getQuotaHistory(storageId, limit = 100) {
    return this.quotaProjectionService.getQuotaHistory(storageId, limit);
  }

  getStorage(storageId) {
    return this.registry.getStorage(storageId);
  }

  getStorageMeta(storageId) {
    return this.registry.getStorageMeta(storageId);
  }

  isUploadAllowed(storageId) {
    const entry = this.registry.getStorageMeta(storageId);
    if (!entry) return false;

    const storageConfig = this.registry.getConfig();
    const isWhitelisted = Array.isArray(storageConfig.allowedUploadChannels)
      ? storageConfig.allowedUploadChannels.includes(storageId)
      : true;

    return Boolean(entry.allowUpload) && isWhitelisted && !this.isQuotaExceeded(storageId);
  }

  isQuotaExceeded(storageId) {
    const entry = this.registry.getStorageMeta(storageId);
    if (!entry) return true;

    if (!entry.quotaLimitGB || entry.quotaLimitGB <= 0) {
      return false;
    }

    const usedBytes = this.quotaProjectionService.getUsedBytes(storageId);
    const limitBytes = entry.quotaLimitGB * 1024 * 1024 * 1024;
    const thresholdPercent = entry.disableThresholdPercent || 95;
    const thresholdBytes = limitBytes * (thresholdPercent / 100);

    return usedBytes >= thresholdBytes;
  }

  listEnabledStorages() {
    return this.registry.listEnabledStorages();
  }

  getDefaultStorageId() {
    return this.registry.getDefaultStorageId();
  }

  async reload() {
    await this.registry.reload();
    await this.maintenanceScheduler.refresh();
  }

  async testConnection(type, instanceConfig) {
    return this.registry.testConnection(type, instanceConfig);
  }

  selectUploadChannel(preferredType = null, excludeIds = []) {
    return this.uploadSelector.selectUploadChannel(preferredType, excludeIds);
  }

  getUsageStats() {
    return this.quotaProjectionService.getUsageStats();
  }

  async applyPendingQuotaEvents({ operationId = null, adjustUsageStats = true, recordSnapshots = true } = {}) {
    return this.quotaProjectionService.applyPendingQuotaEvents({
      operationId,
      adjustUsageStats,
      recordSnapshots,
    });
  }

  async rebuildQuotaStats() {
    return this.quotaProjectionService.rebuildAllQuotaStats();
  }

  async verifyQuotaConsistency() {
    return this.quotaProjectionService.verifyQuotaConsistency();
  }

  getUsedBytes(storageId) {
    return this.quotaProjectionService.getUsedBytes(storageId);
  }

  getAllQuotaStats() {
    return this.quotaProjectionService.getAllQuotaStats();
  }

  async recoverPendingOperations(options = {}) {
    return this.recoveryService.recoverPendingOperations(options);
  }

  getEffectiveUploadLimits(storageId) {
    const entry = this.registry.getStorageMeta(storageId);
    const sys = this.registry.getUploadConfig() || {};

    if (entry && entry.enableSizeLimit) {
      return {
        enableSizeLimit: true,
        sizeLimitMB: entry.sizeLimitMB || sys.defaultSizeLimitMB || 10,
        enableChunking: Boolean(entry.enableChunking),
        chunkSizeMB: entry.chunkSizeMB || sys.defaultChunkSizeMB || 5,
        maxChunks: entry.maxChunks ?? sys.defaultMaxChunks ?? 0,
        enableMaxLimit: Boolean(entry.enableMaxLimit),
        maxLimitMB: entry.maxLimitMB || sys.defaultMaxLimitMB || 100,
      };
    }

    if (sys.enableSizeLimit) {
      return {
        enableSizeLimit: true,
        sizeLimitMB: sys.defaultSizeLimitMB || 10,
        enableChunking: Boolean(sys.enableChunking),
        chunkSizeMB: sys.defaultChunkSizeMB || 5,
        maxChunks: sys.defaultMaxChunks ?? 0,
        enableMaxLimit: Boolean(sys.enableMaxLimit),
        maxLimitMB: sys.defaultMaxLimitMB || 100,
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

const storageManager = new StorageManager();

export { StorageManager };
export default storageManager;
