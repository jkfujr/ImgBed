import config from '../config/index.js';
import { sqlite } from '../database/index.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

import LocalStorage from './local.js';
import S3Storage from './s3.js';
import TelegramStorage from './telegram.js';
import DiscordStorage from './discord.js';
import HuggingFaceStorage from './huggingface.js';
import ExternalStorage from './external.js';

class StorageManager {
    constructor() {
        this.config = config.storage || {};
        this.uploadConfig = config.upload || {};
        this.instances = new Map();
        this.quotaProjection = new Map();
        this.usageStats = new Map();
        this.roundRobinIndex = 0;
        this._fullRebuildTimer = null;

        this._init().catch((err) => console.error('[StorageManager] 初始化失败:', err.message));
    }

    async _init() {
        await this.reload();
        await this._loadQuotaFromHistory();
        await this._initUsageStats();
        await this.applyPendingQuotaEvents({ adjustUsageStats: false, recordSnapshots: true });

        this._rebuildAllQuotaStats().catch((err) =>
            console.error('[StorageManager] 初始化容量全量校正失败:', err.message));

        this._startFullRebuildTimer();
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
                console.log(`[StorageManager] 已从数据库加载 ${latestRecords.length} 个渠道的容量快照`);
            }
        } catch (err) {
            console.error('[StorageManager] 从数据库加载容量快照失败:', err.message);
        }
    }

    async getQuotaHistory(storageId, limit = 100) {
        try {
            return sqlite.prepare(
                'SELECT * FROM storage_quota_history WHERE storage_id = ? ORDER BY recorded_at DESC LIMIT ?'
            ).all(storageId, limit);
        } catch (err) {
            console.error('[StorageManager] 获取容量历史失败:', err.message);
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
            const cfgPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../config.json');
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
                    console.error(`[StorageManager] 加载实例 ${sFile.id} 失败:`, err.message);
                }
            }

            console.log('[StorageManager] 存储渠道配置已加载，当前实例:', [...this.instances.keys()]);

            if (this._fullRebuildTimer) {
                this._rebuildAllQuotaStats().catch(() => {});
                this._stopFullRebuildTimer();
                this._startFullRebuildTimer();
            }
        } catch (err) {
            console.error('[StorageManager] reload 失败:', err.message);
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
            console.error('[StorageManager] 初始化使用统计失败:', err.message);
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
            console.warn('[StorageManager] 没有可用的上传渠道');
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
                console.error('[StorageManager] 应用容量事件失败，已回滚:', projectionErr.message);
                throw projectionErr;
            }

            return { applied: rows.length, storageIds: [...affectedStorageIds] };
        } catch (err) {
            console.error('[StorageManager] 应用容量事件失败:', err.message);
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

            for (const row of rows) {
                const storageId = row.storage_instance_id;
                const usedBytes = Number(row.used_bytes) || 0;
                const fileCount = Number(row.file_count) || 0;
                nextProjection.set(storageId, usedBytes);
                nextUsageStats.set(storageId, { uploadCount: 0, fileCount });
                historyRecords.push({ storage_id: storageId, used_bytes: usedBytes });
            }

            const rebuildProjection = sqlite.transaction((records) => {
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
            });

            rebuildProjection(historyRecords);
            this.quotaProjection = nextProjection;
            this.usageStats = nextUsageStats;

            console.log(`[StorageManager] 容量缓存全量校正完成，已持久化 ${historyRecords.length} 条记录`);
        } catch (err) {
            console.error('[StorageManager] 容量缓存全量校正失败:', err.message);
        }
    }

    _startFullRebuildTimer() {
        const intervalHours = config.upload?.fullCheckIntervalHours || 6;
        const intervalMs = intervalHours * 60 * 60 * 1000;

        this._fullRebuildTimer = setInterval(() => {
            console.log('[StorageManager] 定时全量容量校正开始...');
            this._rebuildAllQuotaStats().catch(() => {});
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
export default storageManager;
