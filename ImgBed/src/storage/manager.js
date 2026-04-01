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

        // 负载均衡状态维护
        this.roundRobinIndex = 0;
        this.usageStats = new Map();

        // 自动将配置中的已启用存储进行实例化映射
        const configuredStorages = this.config.storages || [];
        for (const storageConfig of configuredStorages) {
            if (storageConfig.enabled) {
                try {
                    const instance = this._createInstance(storageConfig.type, storageConfig.config || {});
                    this.instances.set(storageConfig.id, {
                        type: storageConfig.type,
                        allowUpload: storageConfig.allowUpload,
                        weight: storageConfig.weight || 1,
                        quotaLimitGB: storageConfig.quotaLimitGB,
                        disableThresholdPercent: storageConfig.disableThresholdPercent || 95,
                        instance: instance
                    });
                } catch (e) {
                    console.error(`[StorageManager] 加载存储实例 ${storageConfig.id} 失败:`, e.message);
                }
            }
        }

        // 异步初始化使用统计
        this._initUsageStats().catch(err => console.error('[StorageManager] 初始化使用统计失败:', err.message));
    }

    /**
     * 根据类型实例化各类渠道
     */
    _createInstance(type, instanceConfig) {
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
     * @param {number|null} usedBytes 已用字节总数（可选，不传则不检查容量限制）
     */
    isUploadAllowed(storageId, usedBytes = null) {
        const entry = this.instances.get(storageId);
        if (!entry) return false;

        // 必须配置中 allowUpload=true，并且也在全局上传白名单列表中
        const isWhitelisted = Array.isArray(this.config.allowedUploadChannels)
                                ? this.config.allowedUploadChannels.includes(storageId)
                                : true;

        if (!entry.allowUpload || !isWhitelisted) {
            return false;
        }

        // 容量检查 - 如果提供了已用容量且超限，则不允许上传
        if (usedBytes !== null && this.isQuotaExceeded(storageId, usedBytes)) {
            return false;
        }

        return true;
    }

    /**
     * 检查指定渠道是否超出容量限制
     * @param {string} storageId 渠道 ID
     * @param {number} usedBytes 已用字节总数
     * @returns {boolean} true=已超限，false=未超限
     */
    isQuotaExceeded(storageId, usedBytes) {
        const entry = this.instances.get(storageId);
        if (!entry) return true;

        // 如果没有设置容量限制（null 或 0），不限制
        if (!entry.quotaLimitGB || entry.quotaLimitGB <= 0) {
            return false;
        }

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
    reload() {
        const fs = require('fs');
        const path = require('path');
        const cfgPath = path.resolve(__dirname, '../../config.json');
        const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
        this.config = cfg.storage || {};
        this.instances.clear();
        for (const s of this.config.storages || []) {
            if (s.enabled) {
                try {
                    const inst = this._createInstance(s.type, s.config || {});
                    this.instances.set(s.id, {
                        type: s.type,
                        allowUpload: s.allowUpload,
                        weight: s.weight || 1,
                        quotaLimitGB: s.quotaLimitGB,
                        disableThresholdPercent: s.disableThresholdPercent || 95,
                        instance: inst
                    });
                } catch (e) {
                    console.error(`[StorageManager] reload 实例 ${s.id} 失败:`, e.message);
                }
            }
        }
        console.log('[StorageManager] 存储渠道配置已热加载，当前实例:', [...this.instances.keys()]);
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
    selectUploadChannel(preferredType = null) {
        const strategy = this.config.loadBalanceStrategy || 'default';

        // 获取所有允许上传的渠道
        let uploadableChannels = Array.from(this.instances.entries())
            .filter(([id]) => this.isUploadAllowed(id))
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
            default:
                return this.getDefaultStorageId();
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
}

// 导出单例实例，以确保只解析和持有一次配置
const storageManager = new StorageManager();
module.exports = storageManager;
