import { writeSystemConfig, syncAllowedUploadChannels } from './config-io.js';

/**
 * 应用存储配置变更：同步 allowedUploadChannels、写入文件、重载 storageManager
 */
async function applyStorageConfigChange({ cfg, storageManager }) {
  syncAllowedUploadChannels(cfg);
  writeSystemConfig(cfg);
  await storageManager.reload();
}

export { applyStorageConfigChange, };
