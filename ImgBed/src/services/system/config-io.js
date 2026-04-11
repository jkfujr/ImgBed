import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const CONFIG_CACHE_TTL_MS = 5000;
const configCache = new Map();

/**
 * 获取系统配置文件的正确路径
 * 与 src/config/index.js 保持一致：从 appRoot/data/config.json 读取
 */
export function getSystemConfigPath() {
  const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
  return path.join(appRoot, 'data', 'config.json');
}

/**
 * 读取系统配置文件
 */
function readSystemConfig(configPath) {
  const now = Date.now();
  const stats = fs.statSync(configPath);
  const cached = configCache.get(configPath);

  if (cached && cached.expireAt > now && cached.mtimeMs === stats.mtimeMs) {
    return cached.value;
  }

  const raw = fs.readFileSync(configPath, 'utf8');
  const value = JSON.parse(raw);
  configCache.set(configPath, {
    value,
    mtimeMs: stats.mtimeMs,
    expireAt: now + CONFIG_CACHE_TTL_MS,
  });
  return value;
}

/**
 * 写入系统配置文件
 */
function writeSystemConfig(configPath, cfg) {
  fs.writeFileSync(configPath, JSON.stringify(cfg, null, 2), 'utf8');
  const stats = fs.statSync(configPath);
  configCache.set(configPath, {
    value: cfg,
    mtimeMs: stats.mtimeMs,
    expireAt: Date.now() + CONFIG_CACHE_TTL_MS,
  });
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
