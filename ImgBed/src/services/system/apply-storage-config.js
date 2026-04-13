import { writeRuntimeConfig } from '../../config/index.js';

function normalizeStorageConfig(cfg) {
  cfg.storage = cfg.storage || {};
  const storages = Array.isArray(cfg.storage.storages) ? cfg.storage.storages : [];
  cfg.storage.allowedUploadChannels = storages
    .filter((storage) => storage.allowUpload && storage.enabled)
    .map((storage) => storage.id);
}

/**
 * 应用存储配置变更：同步 allowedUploadChannels、写入文件、重载 storageManager
 */
async function applyStorageConfigChange({ cfg, storageManager }) {
  normalizeStorageConfig(cfg);
  writeRuntimeConfig(cfg);
  await storageManager.reload();
}

export { applyStorageConfigChange, };
