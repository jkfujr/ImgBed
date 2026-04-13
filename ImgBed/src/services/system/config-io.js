import { readRuntimeConfig, writeRuntimeConfig } from '../../config/index.js';

/**
 * 读取系统配置文件
 */
function readSystemConfig() {
  return readRuntimeConfig();
}

/**
 * 写入系统配置文件
 */
function writeSystemConfig(cfg) {
  return writeRuntimeConfig(cfg);
}

/**
 * 根据 allowUpload 和 enabled 自动重新计算 allowedUploadChannels
 */
function syncAllowedUploadChannels(cfg) {
  cfg.storage.allowedUploadChannels = (cfg.storage.storages || [])
    .filter((s) => s.allowUpload && s.enabled)
    .map((s) => s.id);
}

export {
  readSystemConfig,
  writeSystemConfig,
  syncAllowedUploadChannels,
};
