import { NotFoundError, ValidationError } from '../../errors/AppError.js';

function createStorageConfigService({
  readRuntimeConfig,
  writeRuntimeConfig,
  storageManager,
  cacheInvalidation,
  freezeStorageFiles,
  updateLoadBalanceConfig,
  applyStorageConfigChange,
  validateStorageChannelInput,
  buildNewStorageChannel,
  applyStorageFieldUpdates,
  applyStorageConfigPatch,
  validStorageTypes = [],
  preserveNullConfigKeys = [],
} = {}) {
  function ensureStorageConfig(cfg) {
    cfg.storage = cfg.storage || {};
    cfg.storage.storages = Array.isArray(cfg.storage.storages) ? cfg.storage.storages : [];
    return cfg.storage.storages;
  }

  function throwValidationError(validationError) {
    if (validationError) {
      throw new ValidationError(validationError.message);
    }
  }

  return {
    async testStorageConnection(type, storageConfig = {}) {
      if (!type || !validStorageTypes.includes(type)) {
        throw new ValidationError(`不支持的存储类型: ${type}`);
      }

      const result = await storageManager.testConnection(type, storageConfig);
      if (!result.ok) {
        throw new ValidationError(result.message);
      }

      return result;
    },

    async updateLoadBalance(body = {}) {
      const cfg = readRuntimeConfig();
      throwValidationError(updateLoadBalanceConfig(cfg, body));
      writeRuntimeConfig(cfg);
      await storageManager.reload();
      cacheInvalidation.invalidateStorages();
    },

    async createStorage(body = {}) {
      throwValidationError(validateStorageChannelInput(body, validStorageTypes));

      const cfg = readRuntimeConfig();
      const storages = ensureStorageConfig(cfg);

      if (storages.some((storage) => storage.id === body.id)) {
        throw new ValidationError(`渠道 ID "${body.id}" 已存在`);
      }

      const storage = buildNewStorageChannel(body);
      cfg.storage.storages = [...storages, storage];

      await applyStorageConfigChange({ cfg, storageManager });
      cacheInvalidation.invalidateStorages();

      return storage;
    },

    async updateStorage(id, body = {}) {
      const cfg = readRuntimeConfig();
      const storages = ensureStorageConfig(cfg);
      const storageIndex = storages.findIndex((storage) => storage.id === id);

      if (storageIndex === -1) {
        throw new NotFoundError(`渠道 "${id}" 不存在`);
      }

      const storage = storages[storageIndex];
      applyStorageFieldUpdates(storage, body);

      if (body.config !== undefined) {
        storage.config = applyStorageConfigPatch(
          storage.config,
          body.config,
          storage.type,
          preserveNullConfigKeys,
        );
      }

      await applyStorageConfigChange({ cfg, storageManager });
      cacheInvalidation.invalidateStorages();

      return storage;
    },

    async deleteStorage(id) {
      const cfg = readRuntimeConfig();
      const storages = ensureStorageConfig(cfg);

      if (cfg.storage.default === id) {
        throw new ValidationError('不能删除当前默认渠道，请先切换默认渠道');
      }

      if (!storages.some((storage) => storage.id === id)) {
        throw new NotFoundError(`渠道 "${id}" 不存在`);
      }

      cfg.storage.storages = storages.filter((storage) => storage.id !== id);

      freezeStorageFiles(id);
      await applyStorageConfigChange({ cfg, storageManager });
      cacheInvalidation.invalidateStorages();
      cacheInvalidation.invalidateFiles();
      cacheInvalidation.invalidateDashboard();
    },

    async setDefaultStorage(id) {
      const cfg = readRuntimeConfig();
      const storages = ensureStorageConfig(cfg);

      if (!storages.some((storage) => storage.id === id)) {
        throw new NotFoundError(`渠道 "${id}" 不存在`);
      }

      cfg.storage.default = id;
      await applyStorageConfigChange({ cfg, storageManager });
      cacheInvalidation.invalidateStorages();
    },

    async toggleStorage(id) {
      const cfg = readRuntimeConfig();
      const storages = ensureStorageConfig(cfg);
      const storage = storages.find((item) => item.id === id);

      if (!storage) {
        throw new NotFoundError(`渠道 "${id}" 不存在`);
      }

      storage.enabled = !storage.enabled;
      await applyStorageConfigChange({ cfg, storageManager });
      cacheInvalidation.invalidateStorages();

      return storage.enabled;
    },
  };
}

export { createStorageConfigService };
