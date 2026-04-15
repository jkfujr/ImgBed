class StorageRuntime {
  constructor({
    registry,
    quotaProjectionService,
    storagePolicyService,
    uploadSelector,
    recoveryService,
    maintenanceScheduler,
  } = {}) {
    this._registry = registry;
    this._quotaProjectionService = quotaProjectionService;
    this._storagePolicyService = storagePolicyService;
    this._uploadSelector = uploadSelector;
    this._recoveryService = recoveryService;
    this._maintenanceScheduler = maintenanceScheduler;
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
      await this._registry.reload();
      await this._quotaProjectionService.loadQuotaFromCache();
      await this._quotaProjectionService.initUsageStats();
      await this._quotaProjectionService.applyPendingQuotaEvents({
        adjustUsageStats: false,
        recordSnapshots: true,
      });

      const consistency = await this._quotaProjectionService.verifyQuotaConsistency().catch(() => ({
        consistent: false,
      }));

      if (!consistency.consistent) {
        await this._quotaProjectionService.rebuildAllQuotaStats();
      }

      await this._recoveryService.recoverPendingOperations();
      this._isInitialized = true;
    })();

    try {
      await this._initializePromise;
    } catch (error) {
      this._initializePromise = null;
      throw error;
    }

    this._initializePromise = null;
  }

  async startMaintenance() {
    await this.initialize();
    await this._maintenanceScheduler.start();
  }

  stopMaintenance() {
    this._maintenanceScheduler.stop();
  }

  async reload() {
    await this._registry.reload();
    await this._maintenanceScheduler.refresh();
  }

  getStorage(storageId) {
    return this._registry.getStorage(storageId);
  }

  getStorageMeta(storageId) {
    return this._registry.getStorageMeta(storageId);
  }

  getDefaultStorageId() {
    return this._registry.getDefaultStorageId();
  }

  selectUploadChannel(preferredType = null, excludeIds = []) {
    return this._uploadSelector.selectUploadChannel(preferredType, excludeIds);
  }

  async testConnection(type, instanceConfig) {
    return this._registry.testConnection(type, instanceConfig);
  }

  async getQuotaHistory(storageId, limit = 100) {
    return this._quotaProjectionService.getQuotaHistory(storageId, limit);
  }

  getUsageStats() {
    return this._quotaProjectionService.getUsageStats();
  }

  getAllQuotaStats() {
    return this._quotaProjectionService.getAllQuotaStats();
  }

  async verifyQuotaConsistency() {
    return this._quotaProjectionService.verifyQuotaConsistency();
  }

  async rebuildQuotaStats() {
    return this._quotaProjectionService.rebuildAllQuotaStats();
  }

  async recoverPendingOperations(options = {}) {
    return this._recoveryService.recoverPendingOperations(options);
  }

  isUploadAllowed(storageId) {
    return this._storagePolicyService.isUploadAllowed(storageId);
  }

  getEffectiveUploadLimits(storageId) {
    return this._storagePolicyService.getEffectiveUploadLimits(storageId);
  }
}

export {
  StorageRuntime,
};
