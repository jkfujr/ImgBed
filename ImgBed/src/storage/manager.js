import config from '../config/index.js';
import { sqlite } from '../database/index.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createLogger } from '../utils/logger.js';

const log = createLogger('storage');

import LocalStorage from './local.js';
import S3Storage from './s3.js';
import TelegramStorage from './telegram.js';
import DiscordStorage from './discord.js';
import HuggingFaceStorage from './huggingface.js';
import ExternalStorage from './external.js';
import {
    buildQuotaEvent,
    insertQuotaEvents,
    markOperationCommitted,
    markOperationCompensated,
    markOperationCompleted,
    markOperationCompensationPending,
    markOperationFailed,
} from '../services/system/storage-operations.js';
import { parseStorageConfig, removeStoredArtifacts } from '../services/files/storage-artifacts.js';
import { getSystemConfigPath } from '../services/system/config-io.js';

class StorageManager {
    constructor({ db = sqlite, autoInit = true } = {}) {
        this.db = db;
        this.config = config.storage || {};
        this.uploadConfig = config.upload || {};
        this.instances = new Map();
        this.quotaProjection = new Map();
        this.usageStats = new Map();
        this.roundRobinIndex = 0;
        this._fullRebuildTimer = null;
        this._compensationRetryTimer = null;
        this._isRecoveryRunning = false;

        if (autoInit) {
            this._init().catch((err) => log.error({ err }, '初始化失败'));
        }
    }

    async _init() {
        await this.reload();
        await this._loadQuotaFromCache();
        await this._initUsageStats();
        await this.applyPendingQuotaEvents({ adjustUsageStats: false, recordSnapshots: true });

        this._rebuildAllQuotaStats().catch((err) =>
            log.error({ err }, '初始化容量全量校正失败'));

        this._startFullRebuildTimer();
        this._recoverStaleOperations().catch((err) =>
            log.error({ err }, '启动恢复失败'));
        this._startCompensationRetryTimer();
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

            log.info({ count: operations.length }, '恢复调度: 发现异常操作');

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
            markOperationFailed(db, operation.id, err);
            log.error({ operationId: operation.id, err }, '恢复失败');
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

        const configObj = parseStorageConfig(fileRecord.storage_config);
        const instanceId = operation.source_storage_id || fileRecord.storage_instance_id || configObj.instance_id || null;
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
        log.info({ operationId: operation.id }, '恢复成功 (remote_done -> completed)');
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
        log.info({ operationId: operation.id }, '恢复成功 (committed -> completed)');
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
        log.info({ operationId: operation.id }, '补偿成功');
    }

    _startCompensationRetryTimer() {
        const db = this.db;

        if (this._compensationRetryTimer) {
            return;
        }

        const intervalMs = 5 * 60 * 1000;
        this._compensationRetryTimer = setInterval(async () => {
            try {
                const pending = db.prepare(`
                    SELECT COUNT(*) AS count FROM storage_operations
                    WHERE status IN ('remote_done', 'committed', 'compensation_pending')
                `).get();

                if (pending.count > 0) {
                    log.info({ count: pending.count }, '定时恢复: 发现异常操作');
                    await this._recoverStaleOperations();
                }
            } catch (err) {
                log.error({ err }, '定时恢复失败');
            }
        }, intervalMs);

        this._compensationRetryTimer.unref();
    }

    _stopCompensationRetryTimer() {
        if (this._compensationRetryTimer) {
            clearInterval(this._compensationRetryTimer);
            this._compensationRetryTimer = null;
        }
    }

    async _loadQuotaFromCache() {
        try {
            const cacheRecords = sqlite.prepare(`
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
            log.warn({ err }, '从缓存表加载容量失败，回退到历史表');
            await this._loadQuotaFromHistory();
        }
    }

    async _loadQuotaFromHistory() {
        try {
            const latestRecords = sqlite.prepare(`
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
            log.error({ err }, '从数据库加载容量快照失败');
        }
    }

    async getQuotaHistory(storageId, limit = 100) {
        try {
            return sqlite.prepare(
                'SELECT * FROM storage_quota_history WHERE storage_id = ? ORDER BY recorded_at DESC LIMIT ?'
            ).all(storageId, limit);
        } catch (err) {
            log.error({ err, storageId }, '获取容量历史失败');
            return [];
        }
    }

    async _createInstance(type, instanceConfig) {
        switch (type.toLowerCase()) {
            case 'local':
                return new LocalStorage(instanceConfig);
            case 's3':
                return new S3Storage(instanceConfig);
            case 'telegram':
                return new TelegramStorage(instanceConfig);
            case 'discord':
                return new DiscordStorage(instanceConfig);
            case 'huggingface':
                return new HuggingFaceStorage(instanceConfig);
            case 'external':
                return new ExternalStorage(instanceConfig);
            default:
                throw new Error(`[StorageManager] 此版本不支持或未知存储类型: ${type}`);
        }
    }

    getStorage(storageId) {
        const entry = this.instances.get(storageId);
        return entry ? entry.instance : null;
    }

    isUploadAllowed(storageId) {
        const entry = this.instances.get(storageId);
        if (!entry) return false;

        const isWhitelisted = Array.isArray(this.config.allowedUploadChannels)
            ? this.config.allowedUploadChannels.includes(storageId)
            : true;

        return Boolean(entry.allowUpload) && isWhitelisted && !this.isQuotaExceeded(storageId);
    }

    isQuotaExceeded(storageId) {
        const entry = this.instances.get(storageId);
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
        return Array.from(this.instances.entries()).map(([id, entry]) => ({
            id,
            type: entry.type,
            allowUpload: entry.allowUpload,
        }));
    }

    getDefaultStorageId() {
        return this.config.default || null;
    }

    async reload() {
        try {
            const cfgPath = getSystemConfigPath();
            const fileCfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
            const storagesInFile = fileCfg.storage?.storages || [];
            const dbChannels = sqlite.prepare('SELECT * FROM storage_channels').all();
            const dbMap = new Map(dbChannels.map((channel) => [channel.id, channel]));

            this.instances.clear();
            this.config = fileCfg.storage || {};
            this.uploadConfig = fileCfg.upload || {};

            for (const sFile of storagesInFile) {
                const sDb = dbMap.get(sFile.id);
                const enabled = sDb ? Boolean(sDb.enabled) : Boolean(sFile.enabled);
                if (!enabled) {
                    continue;
                }

                try {
                    const instance = await this._createInstance(sFile.type, sFile.config || {});
                    this.instances.set(sFile.id, {
                        type: sFile.type,
                        name: sDb ? sDb.name : sFile.name,
                        allowUpload: sDb ? Boolean(sDb.allow_upload) : Boolean(sFile.allowUpload),
                        weight: sDb ? Number(sDb.weight) : (sFile.weight || 1),
                        quotaLimitGB: sDb ? sDb.quota_limit_gb : sFile.quotaLimitGB,
                        disableThresholdPercent: sFile.disableThresholdPercent || 95,
                        enableSizeLimit: Boolean(sFile.enableSizeLimit),
                        sizeLimitMB: sFile.sizeLimitMB,
                        enableChunking: Boolean(sFile.enableChunking),
                        chunkSizeMB: sFile.chunkSizeMB,
                        maxChunks: sFile.maxChunks,
                        enableMaxLimit: Boolean(sFile.enableMaxLimit),
                        maxLimitMB: sFile.maxLimitMB,
                        instance,
                    });
                } catch (err) {
                    log.error({ storageId: sFile.id, err }, '加载实例失败');
                }
            }

            const instanceIds = [...this.instances.keys()].join(', ');
            log.info({ count: this.instances.size }, `存储渠道配置已加载: ${instanceIds}`);

            if (this._fullRebuildTimer) {
                this._rebuildAllQuotaStats().catch(() => {});
                this._stopFullRebuildTimer();
                this._startFullRebuildTimer();
            }
        } catch (err) {
            log.error({ err }, 'reload 失败');
        }
    }

    async testConnection(type, instanceConfig) {
        try {
            const instance = await this._createInstance(type, instanceConfig || {});
            return await instance.testConnection();
        } catch (err) {
            return { ok: false, message: err.message };
        }
    }

    async _initUsageStats() {
        try {
            const stats = sqlite.prepare(`
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
        const strategy = this.config.loadBalanceStrategy || 'default';
        let uploadableChannels = Array.from(this.instances.entries())
            .filter(([id]) => !excludeIds.includes(id) && this.isUploadAllowed(id))
            .map(([id, entry]) => ({ id, type: entry.type, weight: entry.weight || 1 }));

        const scope = this.config.loadBalanceScope || 'global';
        if (scope === 'byType' && preferredType) {
            const enabledTypes = this.config.loadBalanceEnabledTypes || [];
            uploadableChannels = uploadableChannels.filter((channel) =>
                channel.type === preferredType && enabledTypes.includes(channel.type)
            );
        }

        if (uploadableChannels.length === 0) {
            log.warn('没有可用的上传渠道');
            return null;
        }

        switch (strategy) {
            case 'round-robin':
                return this._selectRoundRobin(uploadableChannels);
            case 'random':
                return this._selectRandom(uploadableChannels);
            case 'least-used':
                return this._selectLeastUsed(uploadableChannels);
            case 'weighted':
                return this._selectWeighted(uploadableChannels);
            case 'default':
            default: {
                const defaultId = this.getDefaultStorageId();
                if (defaultId && !excludeIds.includes(defaultId) && this.isUploadAllowed(defaultId)) {
                    return defaultId;
                }
                return uploadableChannels[0]?.id || null;
            }
        }
    }

    _selectRoundRobin(channels) {
        const selected = channels[this.roundRobinIndex % channels.length];
        this.roundRobinIndex++;
        return selected.id;
    }

    _selectRandom(channels) {
        const index = Math.floor(Math.random() * channels.length);
        return channels[index].id;
    }

    _selectLeastUsed(channels) {
        let minCount = Infinity;
        let selectedId = channels[0].id;

        for (const { id } of channels) {
            const stat = this.usageStats.get(id) || { uploadCount: 0, fileCount: 0 };
            if (stat.fileCount < minCount) {
                minCount = stat.fileCount;
                selectedId = id;
            }
        }

        return selectedId;
    }

    _selectWeighted(channels) {
        const weights = this.config.loadBalanceWeights || {};
        let totalWeight = 0;
        const weightedChannels = [];

        for (const { id, weight: channelWeight } of channels) {
            const configWeight = Number(weights[id]) || 1;
            const weight = channelWeight !== 1 ? channelWeight : configWeight;
            totalWeight += weight;
            weightedChannels.push({ id, accumulated: totalWeight });
        }

        if (totalWeight === 0) {
            return channels[0].id;
        }

        const random = Math.random() * totalWeight;
        for (const { id, accumulated } of weightedChannels) {
            if (random <= accumulated) {
                return id;
            }
        }

        return weightedChannels[weightedChannels.length - 1].id;
    }

    getUsageStats() {
        const stats = {};
        this.usageStats.forEach((value, key) => {
            stats[key] = { ...value };
        });
        return stats;
    }

    async applyPendingQuotaEvents({ operationId = null, adjustUsageStats = true, recordSnapshots = true } = {}) {
        try {
            const rows = operationId
                ? sqlite.prepare(
                    'SELECT * FROM storage_quota_events WHERE applied_at IS NULL AND operation_id = ? ORDER BY id ASC'
                ).all(operationId)
                : sqlite.prepare(
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

            const markAppliedStmt = sqlite.prepare(
                'UPDATE storage_quota_events SET applied_at = CURRENT_TIMESTAMP WHERE id = ?'
            );
            const insertSnapshotStmt = sqlite.prepare(
                'INSERT INTO storage_quota_history (storage_id, used_bytes) VALUES (?, ?)'
            );

            const persistProjection = sqlite.transaction((events, storageIds) => {
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
                // 回滚：将已标记的事件恢复为未应用状态
                const eventIds = rows.map(r => r.id);
                if (eventIds.length > 0) {
                    const placeholders = eventIds.map(() => '?').join(',');
                    sqlite.prepare(`UPDATE storage_quota_events SET applied_at = NULL WHERE id IN (${placeholders})`)
                        .run(...eventIds);
                }
                log.error({ err: projectionErr }, '应用容量事件失败，已回滚');
                throw projectionErr;
            }

            return { applied: rows.length, storageIds: [...affectedStorageIds] };
        } catch (err) {
            log.error({ err }, '应用容量事件失败');
            throw err;
        }
    }

    async _rebuildAllQuotaStats() {
        try {
            const rows = sqlite.prepare(`
                SELECT storage_instance_id, SUM(size) AS used_bytes, COUNT(*) AS file_count
                FROM files
                WHERE storage_instance_id IS NOT NULL
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

            const rebuildProjection = sqlite.transaction((records, cacheRecs) => {
                sqlite.prepare(
                    'UPDATE storage_quota_events SET applied_at = CURRENT_TIMESTAMP WHERE applied_at IS NULL'
                ).run();

                if (records.length > 0) {
                    const insertHistoryStmt = sqlite.prepare(
                        'INSERT INTO storage_quota_history (storage_id, used_bytes) VALUES (@storage_id, @used_bytes)'
                    );
                    for (const record of records) {
                        insertHistoryStmt.run(record);
                    }
                }

                // 更新缓存表
                if (cacheRecs.length > 0) {
                    const upsertCacheStmt = sqlite.prepare(`
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

            log.info({ count: historyRecords.length }, '容量缓存全量校正完成');
        } catch (err) {
            log.error({ err }, '容量缓存全量校正失败');
        }
    }

    async verifyQuotaConsistency() {
        try {
            // 从 files 表聚合真实数据
            const actualStats = sqlite.prepare(`
                SELECT storage_instance_id, SUM(size) AS used_bytes, COUNT(*) AS file_count
                FROM files
                WHERE storage_instance_id IS NOT NULL
                GROUP BY storage_instance_id
            `).all();

            // 从缓存表读取
            const cachedStats = sqlite.prepare(`
                SELECT storage_id, used_bytes, file_count
                FROM storage_quota_cache
            `).all();

            const actualMap = new Map(actualStats.map(s => [s.storage_instance_id, s]));
            const cachedMap = new Map(cachedStats.map(s => [s.storage_id, s]));

            const inconsistencies = [];

            // 检查缓存表中的每个存储实例
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

            // 检查实际数据中存在但缓存中缺失的
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
                log.warn({ inconsistencies }, '容量缓存不一致检测到');
                return { consistent: false, inconsistencies };
            }

            log.info('容量缓存一致性校验通过');
            return { consistent: true, inconsistencies: [] };
        } catch (err) {
            log.error({ err }, '容量缓存一致性校验失败');
            throw err;
        }
    }

    _startFullRebuildTimer() {
        const intervalHours = config.upload?.fullCheckIntervalHours || 6;
        const intervalMs = intervalHours * 60 * 60 * 1000;

        this._fullRebuildTimer = setInterval(async () => {
            try {
                log.info('定时容量一致性校验开始');
                const result = await this.verifyQuotaConsistency();

                if (!result.consistent) {
                    log.warn({ count: result.inconsistencies.length }, '检测到容量不一致，执行自动修复');
                    await this._rebuildAllQuotaStats();
                }
            } catch (err) {
                log.error({ err }, '定时容量校验失败');
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

    getEffectiveUploadLimits(storageId) {
        const entry = this.instances.get(storageId);
        const sys = this.uploadConfig || {};

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
