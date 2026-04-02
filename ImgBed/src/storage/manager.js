const config = require('../config');

// 先前各渠道实现的类
const LocalStorage = require('./local');
const S3Storage = require('./s3');
const TelegramStorage = require('./telegram');
const DiscordStorage = require('./discord');
const HuggingFaceStorage = require('./huggingface');
const ExternalStorage = require('./external');

/**
 * 存储渠道管理器
 * 负责实例化及调度 config.json 中的 "storage.storages"
 */
class StorageManager {
    constructor() {
        this.config = config.storage || {};
        this.instances = new Map();
        this.quotaCache = new Map(); // { [storageId]: usedBytes } 容量缓存

        // 负载均衡状态维护
        this.roundRobinIndex = 0;
        this.usageStats = new Map();
        this._fullRebuildTimer = null; // 定时全量校正定时器

        // 异步初始化：从数据库加载元数据并合并实例化
        this._init().catch(err => console.error('[StorageManager] 初始化失败:', err.message));
    }

    /**
     * 内部初始化流程
     */
    async _init() {
        // 1. 优先从数据库加载容量快照（加速启动）
        await this._loadQuotaFromHistory();

        // 2. 加载渠道实例
        await this.reload();

        // 3. 异步初始化使用统计
        this._initUsageStats().catch(err => console.error('[StorageManager] 初始化使用统计失败:', err.message));

        // 4. 异步执行一次全量容量校正（确保数据最新）
        this._rebuildAllQuotaStats().catch(err =>
            console.error('[StorageManager] 初始化容量全量校正失败:', err.message));

        // 5. 启动定时器
        this._startFullRebuildTimer();
    }

    /**
     * 从数据库历史记录加载最近一次的容量快照
     */
    async _loadQuotaFromHistory() {
        try {
            const { db } = require('../database');
            // 为每个渠道取最新的记录
            const latestRecords = await db
                .selectFrom('storage_quota_history')
                .select(['storage_id', 'used_bytes'])
                .where(({ eb, selectFrom }) =>
                    eb('id', 'in',
                        selectFrom('storage_quota_history')
                            .select(eb => eb.fn.max('id').as('max_id'))
                            .groupBy('storage_id')
                    )
                )
                .execute();

            for (const record of latestRecords) {
                this.quotaCache.set(record.storage_id, Number(record.used_bytes) || 0);
            }
            if (latestRecords.length > 0) {
                console.log(`[StorageManager] 已从数据库加载 ${latestRecords.length} 个渠道的容量快照`);
            }
        } catch (err) {
            console.error('[StorageManager] 从数据库加载容量快照失败:', err.message);
        }
    }

    /**
     * 获取历史容量记录（用于趋势分析等）
     * @param {string} storageId
     * @param {number} limit
     */
    async getQuotaHistory(storageId, limit = 100) {
        try {
            const { db } = require('../database');
            return await db.selectFrom('storage_quota_history')
                .where('storage_id', '=', storageId)
                .orderBy('recorded_at', 'desc')
                .limit(limit)
                .execute();
        } catch (err) {
            console.error('[StorageManager] 获取容量历史失败:', err.message);
            return [];
        }
    }

    /**
     * 根据类型实例化各类渠道
     */
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

    /**
     * 取用特定的存储实例
     * @param {string} storageId 配置中写死的 storageId
     * @returns {StorageProvider|null}
     */
    getStorage(storageId) {
        const entry = this.instances.get(storageId);
        return entry ? entry.instance : null;
    }

    /**
     * 判断特定的渠道是否允许进行新文件上传 (为了兼容仅支持读取的旧库)
     * @param {string} storageId 渠道 ID
     * @returns {boolean}
     */
    isUploadAllowed(storageId) {
        const entry = this.instances.get(storageId);
        if (!entry) return false;

        // 必须配置中 allowUpload=true，并且也在全局上传白名单列表中
        const isWhitelisted = Array.isArray(this.config.allowedUploadChannels)
                                ? this.config.allowedUploadChannels.includes(storageId)
                                : true;

        if (!entry.allowUpload || !isWhitelisted) {
            return false;
        }

        // 使用缓存检查容量，如果超限则不允许上传
        if (this.isQuotaExceeded(storageId)) {
            return false;
        }

        return true;
    }

    /**
     * 检查指定渠道是否超出容量限制
     * @param {string} storageId 渠道 ID
     * @returns {boolean} true=已超限，false=未超限
     */
    isQuotaExceeded(storageId) {
        const entry = this.instances.get(storageId);
        if (!entry) return true;

        // 如果没有设置容量限制（null 或 0），不限制
        if (!entry.quotaLimitGB || entry.quotaLimitGB <= 0) {
            return false;
        }

        const usedBytes = this.quotaCache.get(storageId) || 0;
        // 转换单位：GB -> 字节
        const limitBytes = entry.quotaLimitGB * 1024 * 1024 * 1024;
        const thresholdPercent = entry.disableThresholdPercent || 95;
        const thresholdBytes = limitBytes * (thresholdPercent / 100);

        return usedBytes >= thresholdBytes;
    }

    /**
     * 返回所有被成功启用初始化的存储渠道数据
     */
    listEnabledStorages() {
        const list = [];
        this.instances.forEach((value, key) => {
            list.push({
                id: key,
                type: value.type,
                allowUpload: value.allowUpload
            });
        });
        return list;
    }

    /**
     * 提取设置中的默认前端直传网关
     */
    getDefaultStorageId() {
        return this.config.default || null;
    }

    /**
     * 热加载：重新读取 config.json 并重建所有存储实例
     * 在通过 API 修改存储渠道配置后调用，使变更立即生效
     */
    async reload() {
        const fs = require('fs');
        const path = require('path');
        const { db } = require('../database');

        try {
            const cfgPath = path.resolve(__dirname, '../../config.json');
            const fileCfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
            const storagesInFile = fileCfg.storage?.storages || [];

            // 从数据库读取元数据
            const dbChannels = await db.selectFrom('storage_channels').selectAll().execute();
            const dbMap = new Map(dbChannels.map(c => [c.id, c]));

            this.instances.clear();
            this.config = fileCfg.storage || {};
            // 上传限制配置
            this.uploadConfig = fileCfg.upload || {};

            for (const sFile of storagesInFile) {
                const sDb = dbMap.get(sFile.id);

                // 如果数据库没有（可能是新加的），则以文件为准
                const enabled = sDb ? Boolean(sDb.enabled) : Boolean(sFile.enabled);

                if (enabled) {
                    try {
                        const inst = await this._createInstance(sFile.type, sFile.config || {});
                        this.instances.set(sFile.id, {
                            type: sFile.type,
                            name: sDb ? sDb.name : sFile.name,
                            allowUpload: sDb ? Boolean(sDb.allow_upload) : Boolean(sFile.allowUpload),
                            weight: sDb ? Number(sDb.weight) : (sFile.weight || 1),
                            quotaLimitGB: sDb ? sDb.quota_limit_gb : sFile.quotaLimitGB,
                            disableThresholdPercent: sFile.disableThresholdPercent || 95,
                            // 渠道级上传限制配置
                            enableSizeLimit: Boolean(sFile.enableSizeLimit),
                            sizeLimitMB: sFile.sizeLimitMB,
                            enableChunking: Boolean(sFile.enableChunking),
                            chunkSizeMB: sFile.chunkSizeMB,
                            maxChunks: sFile.maxChunks,
                            enableMaxLimit: Boolean(sFile.enableMaxLimit),
                            maxLimitMB: sFile.maxLimitMB,
                            instance: inst
                        });
                    } catch (e) {
                        console.error(`[StorageManager] 加载实例 ${sFile.id} 失败:`, e.message);
                    }
                }
            }
            console.log('[StorageManager] 存储渠道配置已加载，当前实例:', [...this.instances.keys()]);

            // 异步刷新容量统计并重新启动定时器（如果是手动reload）
            if (this._fullRebuildTimer) {
                this._rebuildAllQuotaStats().catch(() => {});
                this._stopFullRebuildTimer();
                this._startFullRebuildTimer();
            }
        } catch (err) {
            console.error('[StorageManager] reload 失败:', err.message);
        }
    }

    /**
     * 测试存储渠道连接（临时创建实例，不写入配置）
     * @param {string} type 存储类型
     * @param {Object} config 存储配置
     * @returns {Promise<{ok: boolean, message: string}>}
     */
    async testConnection(type, config) {
        try {
            const instance = this._createInstance(type, config || {});
            const result = await instance.testConnection();
            return result;
        } catch (err) {
            return { ok: false, message: err.message };
        }
    }

    /**
     * 初始化使用统计（从数据库加载各渠道文件数）
     */
    async _initUsageStats() {
        const { db } = require('../database');
        try {
            const files = await db
                .selectFrom('files')
                .select('storage_config')
                .execute();

            this.usageStats.clear();
            for (const file of files) {
                let config = {};
                try { config = JSON.parse(file.storage_config || '{}'); } catch (e) {}
                const instanceId = config.instance_id;
                if (instanceId) {
                    const stat = this.usageStats.get(instanceId) || { uploadCount: 0, fileCount: 0 };
                    stat.fileCount++;
                    this.usageStats.set(instanceId, stat);
                }
            }
        } catch (err) {
            console.error('[StorageManager] 初始化使用统计失败:', err.message);
        }
    }

    /**
     * 根据负载均衡策略选择上传渠道
     * @param {string|null} preferredType 偏好的渠道类型（用于按类型负载均衡）
     * @returns {string|null} 返回选中的渠道 ID，无可用渠道时返回 null
     */
    selectUploadChannel(preferredType = null, excludeIds = []) {
        const strategy = this.config.loadBalanceStrategy || 'default';

        // 获取所有允许上传的渠道（排除指定的渠道，用于失败自动切换场景）
        let uploadableChannels = Array.from(this.instances.entries())
            .filter(([id]) => !excludeIds.includes(id) && this.isUploadAllowed(id))
            .map(([id, entry]) => ({ id, type: entry.type, weight: entry.weight || 1 }));

        // 如果启用了按类型负载均衡且指定了偏好类型，则只筛选该类型
        const scope = this.config.loadBalanceScope || 'global';
        if (scope === 'byType' && preferredType) {
            const enabledTypes = this.config.loadBalanceEnabledTypes || [];
            uploadableChannels = uploadableChannels.filter(c =>
                c.type === preferredType && enabledTypes.includes(c.type)
            );
        }

        if (uploadableChannels.length === 0) {
            console.warn('[StorageManager] 没有可用的上传渠道');
            return null;
        }

        // 策略路由
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
                // 默认渠道未被排除时直接返回
                if (!excludeIds.includes(defaultId)) {
                    return defaultId;
                }
                // 默认渠道被排除（如 failover 场景），从剩余可用渠道中选择
                return uploadableChannels.length > 0 ? uploadableChannels[0].id : null;
            }
        }
    }

    /**
     * 轮询策略：按顺序循环选择
     */
    _selectRoundRobin(channels) {
        const selected = channels[this.roundRobinIndex % channels.length];
        this.roundRobinIndex++;
        return selected.id;
    }

    /**
     * 随机策略：随机选择一个渠道
     */
    _selectRandom(channels) {
        const index = Math.floor(Math.random() * channels.length);
        return channels[index].id;
    }

    /**
     * 最少使用策略：选择文件数最少的渠道
     */
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

    /**
     * 加权策略：按权重比例选择
     */
    _selectWeighted(channels) {
        const weights = this.config.loadBalanceWeights || {};

        // 计算总权重
        let totalWeight = 0;
        const weightedChannels = [];

        for (const { id, weight: channelWeight } of channels) {
            // 优先使用渠道自身的权重，没有则回退到全局配置权重
            const configW = Number(weights[id]) || 1;
            const w = channelWeight !== 1 ? channelWeight : configW;
            totalWeight += w;
            weightedChannels.push({ id, weight: w, accumulated: totalWeight });
        }

        if (totalWeight === 0) return channels[0].id;

        // 随机选择
        const random = Math.random() * totalWeight;
        for (const { id, accumulated } of weightedChannels) {
            if (random <= accumulated) return id;
        }

        return weightedChannels[weightedChannels.length - 1].id;
    }

    /**
     * 记录上传操作（更新使用统计）
     * @param {string} storageId 渠道 ID
     */
    recordUpload(storageId) {
        const stat = this.usageStats.get(storageId) || { uploadCount: 0, fileCount: 0 };
        stat.uploadCount++;
        stat.fileCount++;
        this.usageStats.set(storageId, stat);
    }

    /**
     * 记录删除操作（更新使用统计）
     * @param {string} storageId 渠道 ID
     */
    recordDelete(storageId) {
        const stat = this.usageStats.get(storageId);
        if (stat && stat.fileCount > 0) {
            stat.fileCount--;
        }
    }

    /**
     * 获取使用统计信息
     */
    getUsageStats() {
        const stats = {};
        this.usageStats.forEach((value, key) => {
            stats[key] = { ...value };
        });
        return stats;
    }

    /**
     * 全量重建容量缓存（从数据库统计）
     */
    async _rebuildAllQuotaStats() {
        const { db } = require('../database');
        try {
            const result = await db
                .selectFrom('files')
                .select(['size', 'storage_config'])
                .execute();

            // 临时统计对象
            const newStats = new Map();

            for (const row of result) {
                let cfg;
                try { cfg = JSON.parse(row.storage_config || '{}'); } catch (e) { continue; }
                const instanceId = cfg.instance_id;
                const fileSize = Number(row.size) || 0;
                if (instanceId) {
                    newStats.set(instanceId, (newStats.get(instanceId) || 0) + fileSize);
                }
            }

            // 更新内存缓存并持久化到历史表
            this.quotaCache.clear();
            const historyRecords = [];

            for (const [id, bytes] of newStats.entries()) {
                this.quotaCache.set(id, bytes);
                historyRecords.push({
                    storage_id: id,
                    used_bytes: bytes
                });
            }

            // 批量插入历史记录
            if (historyRecords.length > 0) {
                await db.insertInto('storage_quota_history')
                    .values(historyRecords)
                    .execute();
            }

            console.log(`[StorageManager] 容量缓存全量校正完成，已持久化 ${historyRecords.length} 条记录`);
        } catch (err) {
            console.error('[StorageManager] 容量缓存全量校正失败:', err.message);
        }
    }

    /**
     * 启动定时全量校正定时器
     */
    _startFullRebuildTimer() {
        // 如果用户配置为每次全量检查，则不启动定时任务
        const mode = config.upload?.quotaCheckMode || 'auto';
        if (mode !== 'auto') {
            return;
        }

        const intervalHours = config.upload?.fullCheckIntervalHours || 6;
        const intervalMs = intervalHours * 60 * 60 * 1000;

        this._fullRebuildTimer = setInterval(() => {
            console.log('[StorageManager] 定时全量容量校正开始...');
            this._rebuildAllQuotaStats().catch(() => {});
        }, intervalMs);

        // 保证进程退出时清除定时器
        this._fullRebuildTimer.unref();
    }

    /**
     * 停止定时全量校正定时器
     */
    _stopFullRebuildTimer() {
        if (this._fullRebuildTimer) {
            clearInterval(this._fullRebuildTimer);
            this._fullRebuildTimer = null;
        }
    }

    /**
     * 增量更新容量缓存（上传成功/删除后调用）
     * @param {string} storageId 渠道ID
     * @param {number} deltaBytes 变化量（正数增加，负数减少）
     */
    updateQuotaCache(storageId, deltaBytes) {
        const current = this.quotaCache.get(storageId) || 0;
        this.quotaCache.set(storageId, current + deltaBytes);
    }

    /**
     * 获取渠道当前缓存的已用容量
     * @param {string} storageId 渠道ID
     * @returns {number} 已用字节数
     */
    getUsedBytes(storageId) {
        return this.quotaCache.get(storageId) || 0;
    }

    /**
     * 获取所有渠道容量缓存快照
     * @returns {Object} { [storageId]: usedBytes }
     */
    getAllQuotaStats() {
        const stats = {};
        for (const [id, bytes] of this.quotaCache.entries()) {
            stats[id] = bytes;
        }
        return stats;
    }

    /**
     * 获取渠道的有效上传限制配置（渠道级优先，未开启则回退到系统级）
     * @param {string} storageId 渠道 ID
     * @returns {Object} { enableSizeLimit, sizeLimitMB, enableChunking, chunkSizeMB, maxChunks, enableMaxLimit, maxLimitMB }
     */
    getEffectiveUploadLimits(storageId) {
        const entry = this.instances.get(storageId);
        const sys = this.uploadConfig || {};

        // 渠道开启了大小限制 → 用渠道自己的配置
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

        // 渠道未开启 → 回退到系统级配置
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

        // 都未开启
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

// 导出单例实例，以确保只解析和持有一次配置
const storageManager = new StorageManager();
module.exports = storageManager;
