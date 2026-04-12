import config from '../config/index.js';
import { sqlite } from '../database/index.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('storage');

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
        this.uploadSelector = new UploadSelector({
            logger: log,
            getConfig: () => this.registry.getConfig(),
            getDefaultStorageId: () => this.registry.getDefaultStorageId(),
            listStorageEntries: () => this.registry.listEntries(),
            isUploadAllowed: (storageId) => this.isUploadAllowed(storageId),
            getUsageStats: () => this.usageStats,
        });
        this.quotaProjection = new Map();
        this.usageStats = new Map();
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
            await this._loadQuotaFromCache();
            await this._initUsageStats();
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

    async _loadQuotaFromCache() {
        const db = this.db;
        try {
            const cacheRecords = db.prepare(`
                SELECT storage_id, used_bytes
                FROM storage_quota_cache
            `).all();

            this.quotaProjection.clear();
            for (const record of cacheRecords) {
                this.quotaProjection.set(record.storage_id, Number(record.used_bytes) || 0);
            }

            if (cacheRecords.length > 0) {
                log.info({ count: cacheRecords.length }, '已从缓存表加载渠道容量');
            }
        } catch (err) {
            log.warn({ err }, '浠庣紦瀛樿〃鍔犺浇瀹归噺澶辫触锛屽洖閫€鍒板巻鍙茶〃');
            await this._loadQuotaFromHistory();
        }
    }

    async _loadQuotaFromHistory() {
        const db = this.db;
        try {
            const latestRecords = db.prepare(`
                SELECT h.storage_id, h.used_bytes
                FROM storage_quota_history h
                INNER JOIN (
                    SELECT storage_id, MAX(id) AS max_id
                    FROM storage_quota_history
                    GROUP BY storage_id
                ) latest ON latest.max_id = h.id
            `).all();

            this.quotaProjection.clear();
            for (const record of latestRecords) {
                this.quotaProjection.set(record.storage_id, Number(record.used_bytes) || 0);
            }

            if (latestRecords.length > 0) {
                log.info({ count: latestRecords.length }, '已从数据库加载渠道容量快照');
            }
        } catch (err) {
            log.error({ err }, '浠庢暟鎹簱鍔犺浇瀹归噺蹇収澶辫触');
        }
    }

    async getQuotaHistory(storageId, limit = 100) {
        const db = this.db;
        try {
            return db.prepare(
                'SELECT * FROM storage_quota_history WHERE storage_id = ? ORDER BY recorded_at DESC LIMIT ?'
            ).all(storageId, limit);
        } catch (err) {
            log.error({ err, storageId }, '鑾峰彇瀹归噺鍘嗗彶澶辫触');
            return [];
        }
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

        const usedBytes = this.quotaProjection.get(storageId) || 0;
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
            this._rebuildAllQuotaStats().catch(() => {});
            this._stopFullRebuildTimer();
            this._startFullRebuildTimer();
        }
    }

    async testConnection(type, instanceConfig) {
        return this.registry.testConnection(type, instanceConfig);
    }

    async _initUsageStats() {
        const db = this.db;
        try {
            const stats = db.prepare(`
                SELECT storage_instance_id, COUNT(*) AS file_count
                FROM files
                WHERE storage_instance_id IS NOT NULL
                GROUP BY storage_instance_id
            `).all();

            this.usageStats.clear();
            for (const row of stats) {
                this.usageStats.set(row.storage_instance_id, {
                    uploadCount: 0,
                    fileCount: Number(row.file_count) || 0,
                });
            }
        } catch (err) {
            log.error({ err }, '初始化使用统计失败');
        }
    }

    selectUploadChannel(preferredType = null, excludeIds = []) {
        return this.uploadSelector.selectUploadChannel(preferredType, excludeIds);
    }

    getUsageStats() {
        const stats = {};
        this.usageStats.forEach((value, key) => {
            stats[key] = { ...value };
        });
        return stats;
    }

    async applyPendingQuotaEvents({ operationId = null, adjustUsageStats = true, recordSnapshots = true } = {}) {
        const db = this.db;
        try {
            const rows = operationId
                ? db.prepare(
                    'SELECT * FROM storage_quota_events WHERE applied_at IS NULL AND operation_id = ? ORDER BY id ASC'
                ).all(operationId)
                : db.prepare(
                    'SELECT * FROM storage_quota_events WHERE applied_at IS NULL ORDER BY id ASC'
                ).all();

            if (rows.length === 0) {
                return { applied: 0, storageIds: [] };
            }

            const nextProjection = new Map(this.quotaProjection);
            const nextUsageStats = new Map();
            for (const [storageId, stat] of this.usageStats.entries()) {
                nextUsageStats.set(storageId, { ...stat });
            }

            const affectedStorageIds = new Set();
            for (const row of rows) {
                const storageId = row.storage_id;
                const currentBytes = nextProjection.get(storageId) || 0;
                nextProjection.set(storageId, currentBytes + (Number(row.bytes_delta) || 0));
                affectedStorageIds.add(storageId);

                if (adjustUsageStats) {
                    const delta = Number(row.file_count_delta) || 0;
                    if (delta !== 0) {
                        const currentStat = nextUsageStats.get(storageId) || { uploadCount: 0, fileCount: 0 };
                        currentStat.fileCount = Math.max(0, currentStat.fileCount + delta);
                        if (row.event_type === 'upload' && delta > 0) {
                            currentStat.uploadCount += delta;
                        }
                        nextUsageStats.set(storageId, currentStat);
                    }
                }
            }

            const markAppliedStmt = db.prepare(
                'UPDATE storage_quota_events SET applied_at = CURRENT_TIMESTAMP WHERE id = ?'
            );
            const insertSnapshotStmt = db.prepare(
                'INSERT INTO storage_quota_history (storage_id, used_bytes) VALUES (?, ?)'
            );

            const persistProjection = db.transaction((events, storageIds) => {
                for (const event of events) {
                    markAppliedStmt.run(event.id);
                }

                if (recordSnapshots) {
                    for (const storageId of storageIds) {
                        insertSnapshotStmt.run(storageId, nextProjection.get(storageId) || 0);
                    }
                }
            });

            try {
                persistProjection(rows, [...affectedStorageIds]);
                this.quotaProjection = nextProjection;
                this.usageStats = nextUsageStats;
            } catch (projectionErr) {
                // 鍥炴粴锛氬皢宸叉爣璁扮殑浜嬩欢鎭㈠涓烘湭搴旂敤鐘舵€?
                const eventIds = rows.map(r => r.id);
                if (eventIds.length > 0) {
                    const placeholders = eventIds.map(() => '?').join(',');
                    db.prepare(`UPDATE storage_quota_events SET applied_at = NULL WHERE id IN (${placeholders})`)
                        .run(...eventIds);
                }
                log.error({ err: projectionErr }, '搴旂敤瀹归噺浜嬩欢澶辫触锛屽凡鍥炴粴');
                throw projectionErr;
            }

            return { applied: rows.length, storageIds: [...affectedStorageIds] };
        } catch (err) {
            log.error({ err }, '搴旂敤瀹归噺浜嬩欢澶辫触');
            throw err;
        }
    }

    async _rebuildAllQuotaStats() {
        const db = this.db;
        try {
            const rows = db.prepare(`
                SELECT storage_instance_id, SUM(size) AS used_bytes, COUNT(*) AS file_count
                FROM files
                WHERE storage_instance_id IS NOT NULL AND status = 'active'
                GROUP BY storage_instance_id
            `).all();

            const nextProjection = new Map();
            const nextUsageStats = new Map();
            const historyRecords = [];
            const cacheRecords = [];

            for (const row of rows) {
                const storageId = row.storage_instance_id;
                const usedBytes = Number(row.used_bytes) || 0;
                const fileCount = Number(row.file_count) || 0;
                nextProjection.set(storageId, usedBytes);
                nextUsageStats.set(storageId, { uploadCount: 0, fileCount });
                historyRecords.push({ storage_id: storageId, used_bytes: usedBytes });
                cacheRecords.push({ storage_id: storageId, used_bytes: usedBytes, file_count: fileCount });
            }

            const rebuildProjection = db.transaction((records, cacheRecs) => {
                db.prepare(
                    'UPDATE storage_quota_events SET applied_at = CURRENT_TIMESTAMP WHERE applied_at IS NULL'
                ).run();

                if (records.length > 0) {
                    const insertHistoryStmt = db.prepare(
                        'INSERT INTO storage_quota_history (storage_id, used_bytes) VALUES (@storage_id, @used_bytes)'
                    );
                    for (const record of records) {
                        insertHistoryStmt.run(record);
                    }
                }

                // 鏇存柊缂撳瓨琛?
                if (cacheRecs.length > 0) {
                    const upsertCacheStmt = db.prepare(`
                        INSERT INTO storage_quota_cache (storage_id, used_bytes, file_count, last_updated)
                        VALUES (@storage_id, @used_bytes, @file_count, CURRENT_TIMESTAMP)
                        ON CONFLICT(storage_id) DO UPDATE SET
                            used_bytes = @used_bytes,
                            file_count = @file_count,
                            last_updated = CURRENT_TIMESTAMP
                    `);
                    for (const record of cacheRecs) {
                        upsertCacheStmt.run(record);
                    }
                }
            });

            rebuildProjection(historyRecords, cacheRecords);
            this.quotaProjection = nextProjection;
            this.usageStats = nextUsageStats;

            log.info({ count: historyRecords.length }, '瀹归噺缂撳瓨鍏ㄩ噺鏍℃瀹屾垚');
        } catch (err) {
            log.error({ err }, '瀹归噺缂撳瓨鍏ㄩ噺鏍℃澶辫触');
        }
    }

    async verifyQuotaConsistency() {
        const db = this.db;
        try {
            // 浠?files 琛ㄨ仛鍚堢湡瀹炴暟鎹?
            const actualStats = db.prepare(`
                SELECT storage_instance_id, SUM(size) AS used_bytes, COUNT(*) AS file_count
                FROM files
                WHERE storage_instance_id IS NOT NULL AND status = 'active'
                GROUP BY storage_instance_id
            `).all();

            // 浠庣紦瀛樿〃璇诲彇
            const cachedStats = db.prepare(`
                SELECT storage_id, used_bytes, file_count
                FROM storage_quota_cache
            `).all();

            const actualMap = new Map(actualStats.map(s => [s.storage_instance_id, s]));
            const cachedMap = new Map(cachedStats.map(s => [s.storage_id, s]));

            const inconsistencies = [];

            // 妫€鏌ョ紦瀛樿〃涓殑姣忎釜瀛樺偍瀹炰緥
            for (const [storageId, cached] of cachedMap) {
                const actual = actualMap.get(storageId);
                if (!actual) {
                    inconsistencies.push({
                        storageId,
                        issue: 'cache_orphan',
                        cached: { used_bytes: cached.used_bytes, file_count: cached.file_count },
                        actual: { used_bytes: 0, file_count: 0 }
                    });
                } else if (cached.used_bytes !== Number(actual.used_bytes) || cached.file_count !== Number(actual.file_count)) {
                    inconsistencies.push({
                        storageId,
                        issue: 'mismatch',
                        cached: { used_bytes: cached.used_bytes, file_count: cached.file_count },
                        actual: { used_bytes: Number(actual.used_bytes), file_count: Number(actual.file_count) }
                    });
                }
            }

            // 妫€鏌ュ疄闄呮暟鎹腑瀛樺湪浣嗙紦瀛樹腑缂哄け鐨?
            for (const [storageId, actual] of actualMap) {
                if (!cachedMap.has(storageId)) {
                    inconsistencies.push({
                        storageId,
                        issue: 'cache_missing',
                        cached: { used_bytes: 0, file_count: 0 },
                        actual: { used_bytes: Number(actual.used_bytes), file_count: Number(actual.file_count) }
                    });
                }
            }

            if (inconsistencies.length > 0) {
                log.warn({ inconsistencies }, '瀹归噺缂撳瓨涓嶄竴鑷存娴嬪埌');
                return { consistent: false, inconsistencies };
            }

            log.info('瀹归噺缂撳瓨涓€鑷存€ф牎楠岄€氳繃');
            return { consistent: true, inconsistencies: [] };
        } catch (err) {
            log.error({ err }, '容量缓存一致性校验失败');
            throw err;
        }
    }

    _startFullRebuildTimer() {
        const intervalHours = this.registry.getUploadConfig()?.fullCheckIntervalHours || 6;
        const intervalMs = intervalHours * 60 * 60 * 1000;

        this._fullRebuildTimer = setInterval(async () => {
            try {
                log.info('定时容量一致性校验开始');
                const result = await this.verifyQuotaConsistency();

                if (!result.consistent) {
                    log.warn({ count: result.inconsistencies.length }, '妫€娴嬪埌瀹归噺涓嶄竴鑷达紝鎵ц鑷姩淇');
                    await this._rebuildAllQuotaStats();
                }
            } catch (err) {
                log.error({ err }, '瀹氭椂瀹归噺鏍￠獙澶辫触');
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
        return this.quotaProjection.get(storageId) || 0;
    }

    getAllQuotaStats() {
        const stats = {};
        for (const [id, bytes] of this.quotaProjection.entries()) {
            stats[id] = bytes;
        }
        return stats;
    }

    async rebuildQuotaStats() {
        return this._rebuildAllQuotaStats();
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


