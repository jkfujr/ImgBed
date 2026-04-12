import config from '../config/index.js';
import { sqlite } from '../database/index.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('storage');

import { QuotaProjectionService } from './quota/quota-projection-service.js';
import { StorageRegistry } from './runtime/storage-registry.js';
import { UploadSelector } from './runtime/upload-selector.js';
import {
    buildQuotaEvent,
    incrementOperationRetryCount,
    insertQuotaEvents,
    markOperationCommitted,
    markOperationCompensated,
    markOperationCompleted,
    markOperationCompensationPending,
    markOperationFailed,
} from '../services/system/storage-operations.js';
import { removeStoredArtifacts } from '../services/files/storage-artifacts.js';

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
        this._fullRebuildTimer = null;
        this._compensationRetryTimer = null;
        this._isRecoveryRunning = false;
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

    _parseOperationPayload(rawPayload) {
        if (!rawPayload) {
            return {};
        }

        try {
            return JSON.parse(rawPayload);
        } catch {
            return {};
        }
    }

    async _recoverStaleOperations({ limit = 50 } = {}) {
        const db = this.db;

        if (this._isRecoveryRunning) {
            return { recovered: 0, total: 0, skipped: true };
        }

        this._isRecoveryRunning = true;

        try {
            const operations = db.prepare(`
                SELECT * FROM storage_operations
                WHERE status IN ('remote_done', 'committed', 'compensation_pending')
                ORDER BY created_at ASC
                LIMIT ?
            `).all(limit);

            if (operations.length === 0) {
                return { recovered: 0, total: 0, skipped: false };
            }

            log.info({ count: operations.length }, '鎭㈠璋冨害: 鍙戠幇寮傚父鎿嶄綔');

            let recovered = 0;
            for (const operation of operations) {
                const current = db.prepare(
                    'SELECT status FROM storage_operations WHERE id = ? LIMIT 1'
                ).get(operation.id);

                if (!current || current.status !== operation.status) {
                    continue;
                }

                await this._executeRecovery(operation);
                recovered++;
            }

            return { recovered, total: operations.length, skipped: false };
        } finally {
            this._isRecoveryRunning = false;
        }
    }

    async _executeRecovery(operation) {
        const db = this.db;
        const MAX_RETRIES = 5;
        const retryCount = operation.retry_count ?? 0;

        if (retryCount >= MAX_RETRIES) {
            markOperationFailed(db, operation.id, new Error(`瓒呰繃鏈€澶ч噸璇曟鏁?${MAX_RETRIES}`));
            log.warn({ operationId: operation.id, retryCount }, '鎭㈠宸茶揪鏈€澶ч噸璇曟鏁帮紝鏍囪澶辫触');
            return;
        }

        try {
            switch (operation.status) {
                case 'remote_done':
                    await this._recoverRemoteDoneOperation(operation);
                    break;
                case 'committed':
                    await this._recoverCommittedOperation(operation);
                    break;
                case 'compensation_pending':
                    await this._executeCompensation(operation);
                    break;
                default:
                    break;
            }
        } catch (err) {
            incrementOperationRetryCount(db, operation.id);
            log.error({ operationId: operation.id, retryCount: retryCount + 1, err }, '鎭㈠澶辫触锛屽凡閫掑閲嶈瘯璁℃暟');
        }
    }

    async _recoverRemoteDoneOperation(operation) {
        const db = this.db;

        if (operation.operation_type !== 'delete') {
            await this._executeCompensation(operation, { payloadField: 'remote_payload' });
            return;
        }

        const fileRecord = db.prepare('SELECT * FROM files WHERE id = ? LIMIT 1').get(operation.file_id);
        if (!fileRecord) {
            markOperationCompleted(db, operation.id);
            return;
        }

        const instanceId = operation.source_storage_id || fileRecord.storage_instance_id || null;
        const fileSize = Number(fileRecord.size) || 0;
        const chunkRecords = fileRecord.is_chunked
            ? db.prepare('SELECT * FROM chunks WHERE file_id = ? ORDER BY chunk_index ASC').all(fileRecord.id)
            : [];

        const compensationPayload = {
            storageId: instanceId,
            storageKey: fileRecord.storage_key,
            isChunked: Boolean(fileRecord.is_chunked),
            chunkRecords,
        };

        const persistDelete = db.transaction(() => {
            db.prepare('DELETE FROM chunks WHERE file_id = ?').run(fileRecord.id);
            db.prepare('DELETE FROM files WHERE id = ?').run(fileRecord.id);

            if (instanceId) {
                insertQuotaEvents(db, [buildQuotaEvent({
                    operationId: operation.id,
                    fileId: fileRecord.id,
                    storageId: instanceId,
                    eventType: 'delete',
                    bytesDelta: -fileSize,
                    fileCountDelta: -1,
                    payload: { storageKey: fileRecord.storage_key },
                })]);
            }

            markOperationCommitted(db, operation.id, {
                sourceStorageId: instanceId,
                compensationPayload,
            });
        });

        persistDelete();
        await this.applyPendingQuotaEvents({ operationId: operation.id, adjustUsageStats: true });
        markOperationCompleted(db, operation.id);
        log.info({ operationId: operation.id }, '鎭㈠鎴愬姛 (remote_done -> completed)');
    }

    async _recoverCommittedOperation(operation) {
        const db = this.db;

        await this.applyPendingQuotaEvents({ operationId: operation.id, adjustUsageStats: true });

        if (operation.operation_type === 'migrate' && operation.compensation_payload) {
            const payload = this._parseOperationPayload(operation.compensation_payload);
            await removeStoredArtifacts({
                storageManager: this,
                storageId: payload.storageId || payload.sourceStorageId,
                storageKey: payload.storageKey || payload.sourceStorageKey,
                isChunked: Boolean(payload.isChunked),
                chunkRecords: payload.chunkRecords || [],
            });
        }

        markOperationCompleted(db, operation.id);
        log.info({ operationId: operation.id }, '鎭㈠鎴愬姛 (committed -> completed)');
    }

    async _executeCompensation(operation, { payloadField = 'compensation_payload' } = {}) {
        const db = this.db;
        const payload = this._parseOperationPayload(operation[payloadField]);
        if (!payload || Object.keys(payload).length === 0) {
            markOperationCompensated(db, operation.id, { compensationPayload: payload });
            return;
        }

        await removeStoredArtifacts({
            storageManager: this,
            storageId: payload.storageId || payload.sourceStorageId || payload.targetStorageId,
            storageKey: payload.storageKey || payload.sourceStorageKey || payload.targetStorageKey,
            isChunked: Boolean(payload.isChunked),
            chunkRecords: payload.chunkRecords || [],
        });

        markOperationCompensated(db, operation.id, { compensationPayload: payload });
        log.info({ operationId: operation.id }, '琛ュ伩鎴愬姛');
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
                        const result = await this._recoverStaleOperations();
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
        return this._recoverStaleOperations(options);
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


