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
        
        // 自动将配置中的已启用存储进行实例化映射
        const configuredStorages = this.config.storages || [];
        for (const storageConfig of configuredStorages) {
            if (storageConfig.enabled) {
                try {
                    const instance = this._createInstance(storageConfig.type, storageConfig.config || {});
                    this.instances.set(storageConfig.id, {
                        type: storageConfig.type,
                        allowUpload: storageConfig.allowUpload,
                        instance: instance
                    });
                } catch (e) {
                    console.error(`[StorageManager] 加载存储实例 ${storageConfig.id} 失败:`, e.message);
                }
            }
        }
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
     */
    isUploadAllowed(storageId) {
        const entry = this.instances.get(storageId);
        if (!entry) return false;
        
        // 必须配置中 allowUpload=true，并且也在全局上传白名单列表中
        const isWhitelisted = Array.isArray(this.config.allowedUploadChannels) 
                                ? this.config.allowedUploadChannels.includes(storageId) 
                                : true;

        return entry.allowUpload && isWhitelisted;
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
                        instance: inst
                    });
                } catch (e) {
                    console.error(`[StorageManager] reload 实例 ${s.id} 失败:`, e.message);
                }
            }
        }
        console.log('[StorageManager] 存储渠道配置已热加载，当前实例:', [...this.instances.keys()]);
    }
}

// 导出单例实例，以确保只解析和持有一次配置
const storageManager = new StorageManager();
module.exports = storageManager;
