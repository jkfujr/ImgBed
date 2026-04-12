import config from '../config/index.js';
import { sqlite } from '../database/index.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('storage');

import { QuotaProjectionService } from './quota/quota-projection-service.js';
import { StorageOperationRecovery } from './recovery/storage-operation-recovery.js';
import { StorageRegistry } from './runtime/storage-registry.js';
import { UploadSelector } from './runtime/upload-selector.js';

class StorageManager {
    constructor({ db = sqlite } = {}) {
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
        this._fullRebuildTimer = null;
        this._compensationRetryTimer = null;
        this._compensationBackoffMs = 5 * 60 * 1000;
        this._initializePromise = null;
        this._isInitialized = false;
        this._maintenanceStarted = false;
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
                log.warn({ err }, 'initialize quota consistency check failed, rebuilding projection');
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

        if (this._maintenanceStarted) {
            return;
        }

        this._startFullRebuildTimer();
        this._startCompensationRetryTimer();
        this._maintenanceStarted = true;
    }

    stopMaintenance() {
        this._stopFullRebuildTimer();
        this._stopCompensationRetryTimer();
        this._maintenanceStarted = false;
    }

    _startCompensationRetryTimer() {
        const db = this.db;
        const MIN_INTERVAL_MS = 5 * 60 * 1000;   // 5 鍒嗛挓
        const MAX_INTERVAL_MS = 60 * 60 * 1000;  // 60 鍒嗛挓涓婇檺

        if (this._compensationRetryTimer) {
            return;
        }

        const scheduleNext = () => {
            this._compensationRetryTimer = setTimeout(async () => {
                try {
                    const pending = db.prepare(`
                        SELECT COUNT(*) AS count FROM storage_operations
                        WHERE status IN ('remote_done', 'committed', 'compensation_pending')
                    `).get();

                    if (pending.count > 0) {
                        log.info({ count: pending.count, nextIntervalMs: this._compensationBackoffMs }, '瀹氭椂鎭㈠: 鍙戠幇寮傚父鎿嶄綔');
                        const result = await this.recoveryService.recoverPendingOperations();
                        if (result.recovered > 0) {
                            // 鏈夋垚鍔熸仮澶嶅垯閲嶇疆閫€閬?
                            this._compensationBackoffMs = MIN_INTERVAL_MS;
                        } else {
                            // 鍏ㄩ儴澶辫触鍒欐寚鏁板姞鍊嶏紝涓嶈秴杩囦笂闄?
                            this._compensationBackoffMs = Math.min(
                                this._compensationBackoffMs * 2,
                                MAX_INTERVAL_MS
                            );
                        }
                    } else {
                        // 鏃犲緟澶勭悊鎿嶄綔锛岄噸缃€€閬?
                        this._compensationBackoffMs = MIN_INTERVAL_MS;
                    }
                } catch (err) {
                    log.error({ err }, '瀹氭椂鎭㈠澶辫触');
                    this._compensationBackoffMs = Math.min(
                        this._compensationBackoffMs * 2,
                        MAX_INTERVAL_MS
                    );
                } finally {
                    if (this._compensationRetryTimer !== null) {
                        scheduleNext();
                    }
                }
            }, this._compensationBackoffMs);

            this._compensationRetryTimer.unref();
        };

        scheduleNext();
    }

    _stopCompensationRetryTimer() {
        if (this._compensationRetryTimer) {
            clearTimeout(this._compensationRetryTimer);
            this._compensationRetryTimer = null;
        }
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

        if (this._fullRebuildTimer) {
            this.quotaProjectionService.rebuildAllQuotaStats().catch(() => {});
            this._stopFullRebuildTimer();
            this._startFullRebuildTimer();
        }
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

    _startFullRebuildTimer() {
        const intervalHours = this.registry.getUploadConfig()?.fullCheckIntervalHours || 6;
        const intervalMs = intervalHours * 60 * 60 * 1000;

        this._fullRebuildTimer = setInterval(async () => {
            try {
                log.info('scheduled quota consistency check started');
                const result = await this.quotaProjectionService.verifyQuotaConsistency();

                if (!result.consistent) {
                    log.warn({ count: result.inconsistencies.length }, 'quota consistency drift detected, rebuilding');
                    await this.quotaProjectionService.rebuildAllQuotaStats();
                }
            } catch (err) {
                log.error({ err }, 'scheduled quota maintenance failed');
            }
        }, intervalMs);

        this._fullRebuildTimer.unref();
    }

    _stopFullRebuildTimer() {
        if (this._fullRebuildTimer) {
            clearInterval(this._fullRebuildTimer);
            this._fullRebuildTimer = null;
        }
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


