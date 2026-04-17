import { readRuntimeConfig } from '../../config/index.js';
import { createLogger } from '../../utils/logger.js';
import DiscordStorage from '../discord.js';
import ExternalStorage from '../external.js';
import HuggingFaceStorage from '../huggingface.js';
import LocalStorage from '../local.js';
import S3Storage from '../s3.js';
import TelegramStorage from '../telegram.js';

const log = createLogger('storage');

const STORAGE_DRIVERS = new Map([
  ['local', LocalStorage],
  ['s3', S3Storage],
  ['telegram', TelegramStorage],
  ['discord', DiscordStorage],
  ['huggingface', HuggingFaceStorage],
  ['external', ExternalStorage],
]);

function resolveStorageDriver(type) {
  const driver = STORAGE_DRIVERS.get(String(type || '').toLowerCase());
  if (!driver) {
    throw new Error(`[StorageRegistry] 不支持的存储类型: ${type}`);
  }
  return driver;
}

class StorageRegistry {
  constructor({ db, logger = log, initialConfig = {}, initialUploadConfig = {} } = {}) {
    this.db = db;
    this.log = logger;
    this.config = initialConfig;
    this.uploadConfig = initialUploadConfig;
    this.instances = new Map();
  }

  async createStorageInstance(type, instanceConfig) {
    const StorageDriver = resolveStorageDriver(type);
    return new StorageDriver(instanceConfig);
  }

  getStorage(storageId) {
    const entry = this.instances.get(storageId);
    return entry ? entry.instance : null;
  }

  getStorageMeta(storageId) {
    const entry = this.instances.get(storageId);
    return entry ? { ...entry } : null;
  }

  listEnabledStorages() {
    return Array.from(this.instances.entries()).map(([id, entry]) => ({
      id,
      type: entry.type,
      allowUpload: entry.allowUpload,
    }));
  }

  listEntries() {
    return Array.from(this.instances.entries());
  }

  getDefaultStorageId() {
    return this.config.default || null;
  }

  getConfig() {
    return this.config;
  }

  getUploadConfig() {
    return this.uploadConfig;
  }

  async reload() {
    try {
      const fileCfg = readRuntimeConfig();
      const storagesInFile = fileCfg.storage?.storages || [];
      const nextInstances = new Map();
      const nextConfig = fileCfg.storage || {};
      const nextUploadConfig = fileCfg.upload || {};

      for (const sFile of storagesInFile) {
        const enabled = Boolean(sFile.enabled);
        if (!enabled) {
          continue;
        }

        try {
          const instance = await this.createStorageInstance(sFile.type, sFile.config || {});
          nextInstances.set(sFile.id, {
            type: sFile.type,
            name: sFile.name,
            allowUpload: Boolean(sFile.allowUpload),
            weight: sFile.weight || 1,
            quotaLimitGB: sFile.quotaLimitGB,
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
          this.log.error({ storageId: sFile.id, err }, '存储实例初始化失败');
        }
      }

      this.config = nextConfig;
      this.uploadConfig = nextUploadConfig;
      this.instances = nextInstances;

      const instanceIds = [...this.instances.keys()].join(', ');
      this.log.info({ count: this.instances.size }, `存储注册表已重载: ${instanceIds}`);
    } catch (err) {
      this.log.error({ err }, '存储注册表重载失败');
    }
  }

  async testConnection(type, instanceConfig) {
    try {
      const instance = await this.createStorageInstance(type, instanceConfig || {});
      return await instance.testConnection();
    } catch (err) {
      return { ok: false, message: err.message };
    }
  }

  async hasExistingObjects(type, instanceConfig) {
    const instance = await this.createStorageInstance(type, instanceConfig || {});
    if (typeof instance?.hasExistingObjects !== 'function') {
      throw new Error(`[StorageRegistry] 存储类型 "${type}" 不支持内容检查`);
    }
    return instance.hasExistingObjects();
  }

  async clearStorageContents(type, instanceConfig) {
    const instance = await this.createStorageInstance(type, instanceConfig || {});
    if (typeof instance?.clearBucketContents !== 'function') {
      throw new Error(`[StorageRegistry] 存储类型 "${type}" 不支持内容清空`);
    }
    return instance.clearBucketContents();
  }
}

export { StorageRegistry, resolveStorageDriver };
