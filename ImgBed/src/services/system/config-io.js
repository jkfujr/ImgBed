import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

/**
 * 获取系统配置文件的正确路径
 * 与 src/config/index.js 保持一致：从 appRoot/data/config.json 读取
 */
export function getSystemConfigPath() {
  const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
  return path.join(appRoot, 'data', 'config.json');
}

/**
 * 读取系统配置文件
 */
function readSystemConfig(configPath) {
  const raw = fs.readFileSync(configPath, 'utf8');
  return JSON.parse(raw);
}

/**
 * 写入系统配置文件
 */
function writeSystemConfig(configPath, cfg) {
  fs.writeFileSync(configPath, JSON.stringify(cfg, null, 2), 'utf8');
}

/**
 * 根据 allowUpload 和 enabled 自动重新计算 allowedUploadChannels
 */
function syncAllowedUploadChannels(cfg) {
  cfg.storage.allowedUploadChannels = (cfg.storage.storages || [])
    .filter((s) => s.allowUpload && s.enabled)
    .map((s) => s.id);
}

export { readSystemConfig,
  writeSystemConfig,
  syncAllowedUploadChannels, };
