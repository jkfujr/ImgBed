import { ConflictError, NotFoundError, ValidationError } from '../../errors/AppError.js';

const VALID_S3_NON_EMPTY_ACTIONS = new Set(['keep', 'clear_bucket']);

function createStorageConfigService({
  readRuntimeConfig,
  writeRuntimeConfig,
  storageManager,
  invalidateStorageCaches,
  invalidateFilesCache,
  invalidateDashboardCaches,
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

  function normalizeS3NonEmptyAction(action) {
    if (action === undefined || action === null || action === '') {
      return null;
    }

    const normalizedAction = String(action).trim().toLowerCase();
    if (!VALID_S3_NON_EMPTY_ACTIONS.has(normalizedAction)) {
      throw new ValidationError('s3NonEmptyAction 参数不合法');
    }

    return normalizedAction;
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
      invalidateStorageCaches();
    },

    async createStorage(body = {}) {
      throwValidationError(validateStorageChannelInput(body, validStorageTypes));

      const cfg = readRuntimeConfig();
      const storages = ensureStorageConfig(cfg);

      if (storages.some((storage) => storage.id === body.id)) {
        throw new ValidationError(`渠道 ID "${body.id}" 已存在`);
      }

      if (body.type === 's3') {
        const s3NonEmptyAction = normalizeS3NonEmptyAction(body.s3NonEmptyAction);
        const hasExistingObjects = await storageManager.hasExistingObjects('s3', body.config || {});

        if (hasExistingObjects) {
          if (!s3NonEmptyAction) {
            throw new ConflictError('S3 存储桶中已存在文件，请确认是否需要清空', 'S3_BUCKET_NOT_EMPTY');
          }

          if (s3NonEmptyAction === 'clear_bucket') {
            await storageManager.clearStorageContents('s3', body.config || {});
          }
        }
      }

      const storage = buildNewStorageChannel(body);
      cfg.storage.storages = [...storages, storage];

      await applyStorageConfigChange({ cfg, storageManager });
      invalidateStorageCaches();

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
      invalidateStorageCaches();

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
      invalidateStorageCaches();
      invalidateFilesCache();
      invalidateDashboardCaches();
    },

    async setDefaultStorage(id) {
      const cfg = readRuntimeConfig();
      const storages = ensureStorageConfig(cfg);

      if (!storages.some((storage) => storage.id === id)) {
        throw new NotFoundError(`渠道 "${id}" 不存在`);
      }

      cfg.storage.default = id;
      await applyStorageConfigChange({ cfg, storageManager });
      invalidateStorageCaches();
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
      invalidateStorageCaches();

      return storage.enabled;
    },
  };
}

export { createStorageConfigService };
