import express from 'express';
import { fileURLToPath } from 'url';
import path from 'path';

import { adminAuth } from '../middleware/auth.js';
import storageManager from '../storage/manager.js';
import { sqlite } from '../database/index.js';
import { readSystemConfig, writeSystemConfig, syncAllowedUploadChannels } from '../services/system/config-io.js';
import { insertStorageChannelMeta, updateStorageChannelMeta, deleteStorageChannelMeta } from '../services/system/storage-channel-sync.js';
import { applyStorageConfigChange } from '../services/system/apply-storage-config.js';
import { updateUploadConfig, applyStorageFieldUpdates } from '../services/system/update-config-fields.js';
import { updateLoadBalanceConfig } from '../services/system/update-load-balance.js';
import { buildNewStorageChannel, validateStorageChannelInput } from '../services/system/create-storage-channel.js';
import asyncHandler from '../middleware/asyncHandler.js';
import { ValidationError, NotFoundError } from '../errors/AppError.js';
import { createLogger } from '../utils/logger.js';
import {
  systemConfigCache,
  storagesListCache,
  storagesStatsCache,
  quotaStatsCache,
  loadBalanceCache,
  cacheInvalidation
} from '../middleware/cache.js';
import { getResponseCache } from '../services/cache/response-cache.js';

const log = createLogger('system');
const systemApp = express.Router();
const configPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../config.json');

const SENSITIVE_KEYS = ['secretAccessKey', 'botToken', 'token', 'webhookUrl', 'authHeader'];
const VALID_TYPES = ['local', 's3', 'telegram', 'discord', 'huggingface', 'external'];

function maskStorage(s) {
  const masked = { ...s, config: { ...(s.config || {}) } };
  for (const k of SENSITIVE_KEYS) {
    if (masked.config[k] !== undefined) masked.config[k] = '***';
  }
  return masked;
}

systemApp.use(adminAuth);

/**
 * 读取系统配置（脱敏）
 * GET /api/system/config
 */
systemApp.get('/config', systemConfigCache(), asyncHandler(async (_req, res) => {
  const cfg = readSystemConfig(configPath);
  if (cfg.jwt) cfg.jwt.secret = '******';
  return res.json({ code: 0, message: 'success', data: cfg });
}));

/**
 * 更新系统配置
 * PUT /api/system/config
 */
systemApp.put('/config', asyncHandler(async (req, res) => {
  const body = req.body || {};
  const cfg = readSystemConfig(configPath);

  if (body.security !== undefined) {
    if (body.security.corsOrigin !== undefined)
      cfg.security.corsOrigin = String(body.security.corsOrigin);
    if (body.security.maxFileSize !== undefined)
      cfg.security.maxFileSize = Number(body.security.maxFileSize);
  }
  if (body.storage?.default !== undefined)
    cfg.storage.default = String(body.storage.default);
  if (body.server?.port !== undefined)
    cfg.server.port = Number(body.server.port);

  updateUploadConfig(cfg, body.upload);

  // 更新性能配置
  if (body.performance !== undefined) {
    cfg.performance = cfg.performance || {};
    if (body.performance.s3Multipart !== undefined) {
      cfg.performance.s3Multipart = {
        enabled: Boolean(body.performance.s3Multipart.enabled),
        concurrency: Number(body.performance.s3Multipart.concurrency) || 4,
        maxConcurrency: Number(body.performance.s3Multipart.maxConcurrency) || 8,
        minPartSize: 5242880
      };
    }
  }

  writeSystemConfig(configPath, cfg);

  // 使系统配置缓存失效
  cacheInvalidation.invalidateSystemConfig();

  return res.json({ code: 0, message: '配置已保存，部分配置需重启服务后生效' });
}));

/**
 * 获取存储渠道列表（含完整 config，敏感字段脱敏）
 * GET /api/system/storages
 */
systemApp.get('/storages', storagesListCache(), asyncHandler(async (_req, res) => {
  const cfg = readSystemConfig(configPath);
  const fileStorages = cfg.storage?.storages || [];
  const quotaStats = storageManager.getAllQuotaStats();

  const dbChannels = sqlite.prepare('SELECT * FROM storage_channels').all();
  const dbMap = new Map(dbChannels.map(ch => [ch.id, ch]));

  const list = fileStorages.map(s => {
    const dbCh = dbMap.get(s.id);
    const merged = {
      ...s,
      name: dbCh ? dbCh.name : s.name,
      enabled: dbCh ? Boolean(dbCh.enabled) : s.enabled,
      allowUpload: dbCh ? Boolean(dbCh.allow_upload) : s.allowUpload,
      weight: dbCh ? Number(dbCh.weight) : (s.weight || 1),
      quotaLimitGB: dbCh ? dbCh.quota_limit_gb : s.quotaLimitGB,
      usedBytes: quotaStats[s.id] || 0
    };
    return maskStorage(merged);
  });

  return res.json({ code: 0, message: 'success', data: { list, default: cfg.storage?.default } });
}));

/**
 * 获取存储渠道统计信息
 * GET /api/system/storages/stats
 */
systemApp.get('/storages/stats', storagesStatsCache(), asyncHandler(async (_req, res) => {
  const cfg = readSystemConfig(configPath);
  const fileStorages = cfg.storage?.storages || [];

  const dbChannels = sqlite.prepare('SELECT * FROM storage_channels').all();
  const dbMap = new Map(dbChannels.map(ch => [ch.id, ch]));

  let enabled = 0;
  let allowUpload = 0;
  const byType = {};

  fileStorages.forEach(s => {
    const dbCh = dbMap.get(s.id);
    const isEnabled = dbCh ? Boolean(dbCh.enabled) : s.enabled;
    const canUpload = dbCh ? Boolean(dbCh.allow_upload) : s.allowUpload;

    if (isEnabled) enabled++;
    if (canUpload) allowUpload++;
    byType[s.type] = (byType[s.type] || 0) + 1;
  });

  return res.json({
    code: 0,
    message: 'success',
    data: {
      total: fileStorages.length,
      enabled,
      allowUpload,
      byType
    }
  });
}));

/**
 * 测试存储渠道连接
 * POST /api/system/storages/test
 */
systemApp.post('/storages/test', asyncHandler(async (req, res) => {
  const { type, config: storageConfig } = req.body || {};

  if (!type || !VALID_TYPES.includes(type)) {
    throw new ValidationError(`不支持的存储类型: ${type}`);
  }

  const result = await storageManager.testConnection(type, storageConfig || {});
  if (result.ok) {
    return res.json({ code: 0, message: '连接成功', data: result });
  } else {
    throw new ValidationError(result.message);
  }
}));

/**
 * 获取负载均衡配置
 * GET /api/system/load-balance
 */
systemApp.get('/load-balance', loadBalanceCache(), asyncHandler(async (_req, res) => {
  const cfg = readSystemConfig(configPath);
  return res.json({
    code: 0,
    message: 'success',
    data: {
      strategy: cfg.storage?.loadBalanceStrategy || 'default',
      scope: cfg.storage?.loadBalanceScope || 'global',
      enabledTypes: cfg.storage?.loadBalanceEnabledTypes || [],
      weights: cfg.storage?.loadBalanceWeights || {},
      failoverEnabled: cfg.storage?.failoverEnabled !== false,
      stats: storageManager.getUsageStats()
    }
  });
}));

/**
 * 更新负载均衡配置
 * PUT /api/system/load-balance
 */
systemApp.put('/load-balance', asyncHandler(async (req, res) => {
  const body = req.body || {};
  const cfg = readSystemConfig(configPath);

  const validationError = updateLoadBalanceConfig(cfg, body);
  if (validationError) {
    return res.status(validationError.code).json(validationError);
  }

  writeSystemConfig(configPath, cfg);
  await storageManager.reload();

  // 使负载均衡和存储相关缓存失效
  cacheInvalidation.invalidateStorages();

  return res.json({ code: 0, message: '负载均衡配置已更新' });
}));

/**
 * 新增存储渠道
 * POST /api/system/storages
 */
systemApp.post('/storages', asyncHandler(async (req, res) => {
  const body = req.body || {};

  const validationError = validateStorageChannelInput(body, VALID_TYPES);
  if (validationError) {
    return res.status(validationError.code).json(validationError);
  }

  const cfg = readSystemConfig(configPath);

  if ((cfg.storage.storages || []).some((s) => s.id === body.id)) {
    throw new ValidationError(`渠道 ID "${body.id}" 已存在`);
  }

  const newStorage = buildNewStorageChannel(body);
  cfg.storage.storages = [...(cfg.storage.storages || []), newStorage];

  await insertStorageChannelMeta(newStorage, sqlite);
  await applyStorageConfigChange({ cfg, configPath, storageManager });

  // 使存储相关缓存失效
  cacheInvalidation.invalidateStorages();

  return res.json({ code: 0, message: '存储渠道已新增', data: maskStorage(newStorage) });
}));

/**
 * 编辑存储渠道
 * PUT /api/system/storages/:id
 */
systemApp.put('/storages/:id', asyncHandler(async (req, res) => {
  const id = req.params.id;
  const body = req.body || {};
  const cfg = readSystemConfig(configPath);
  const idx = (cfg.storage.storages || []).findIndex((s) => s.id === id);
  if (idx === -1) {
    throw new NotFoundError(`渠道 "${id}" 不存在`);
  }

  const existing = cfg.storage.storages[idx];
  applyStorageFieldUpdates(existing, body);

  if (body.config !== undefined) {
    existing.config = existing.config || {};
    for (const [k, v] of Object.entries(body.config)) {
      if (SENSITIVE_KEYS.includes(k) && v === null) continue;
      if (existing.type === 's3' && k === 'pathStyle') {
        existing.config[k] = v === true || v === 'true';
        continue;
      }
      existing.config[k] = v;
    }
  }

  await updateStorageChannelMeta(id, existing, sqlite);
  await applyStorageConfigChange({ cfg, configPath, storageManager });

  // 使存储相关缓存失效
  cacheInvalidation.invalidateStorages();

  return res.json({ code: 0, message: '存储渠道已更新', data: maskStorage(existing) });
}));

/**
 * 删除存储渠道
 * DELETE /api/system/storages/:id
 */
systemApp.delete('/storages/:id', asyncHandler(async (req, res) => {
  const id = req.params.id;
  const cfg = readSystemConfig(configPath);
  if (cfg.storage.default === id) {
    throw new ValidationError('不能删除当前默认渠道，请先切换默认渠道');
  }
  const before = (cfg.storage.storages || []).length;
  cfg.storage.storages = (cfg.storage.storages || []).filter((s) => s.id !== id);
  if (cfg.storage.storages.length === before) {
    throw new NotFoundError(`渠道 "${id}" 不存在`);
  }

  await deleteStorageChannelMeta(id, sqlite);
  await applyStorageConfigChange({ cfg, configPath, storageManager });

  // 使存储相关缓存失效
  cacheInvalidation.invalidateStorages();

  return res.json({ code: 0, message: '存储渠道已删除' });
}));

/**
 * 设为默认存储渠道
 * PUT /api/system/storages/:id/default
 */
systemApp.put('/storages/:id/default', asyncHandler(async (req, res) => {
  const id = req.params.id;
  const cfg = readSystemConfig(configPath);
  if (!(cfg.storage.storages || []).some((s) => s.id === id)) {
    throw new NotFoundError(`渠道 "${id}" 不存在`);
  }
  cfg.storage.default = id;
  writeSystemConfig(configPath, cfg);
  await storageManager.reload();

  // 使存储相关缓存失效
  cacheInvalidation.invalidateStorages();

  return res.json({ code: 0, message: `已将 "${id}" 设为默认渠道` });
}));

/**
 * 启用/禁用存储渠道
 * PUT /api/system/storages/:id/toggle
 */
systemApp.put('/storages/:id/toggle', asyncHandler(async (req, res) => {
  const id = req.params.id;
  const cfg = readSystemConfig(configPath);
  const storage = (cfg.storage.storages || []).find((s) => s.id === id);
  if (!storage) {
    throw new NotFoundError(`渠道 "${id}" 不存在`);
  }

  storage.enabled = !storage.enabled;

  await updateStorageChannelMeta(id, storage, sqlite);
  await applyStorageConfigChange({ cfg, configPath, storageManager });

  // 使存储相关缓存失效
  cacheInvalidation.invalidateStorages();

  return res.json({
    code: 0,
    message: `渠道 "${id}" 已${storage.enabled ? '启用' : '禁用'}`,
    data: { enabled: storage.enabled }
  });
}));

/**
 * 获取各存储渠道已用容量统计
 * GET /api/system/quota-stats
 */
systemApp.get('/quota-stats', quotaStatsCache(), asyncHandler(async (_req, res) => {
  const stats = storageManager.getAllQuotaStats();
  return res.json({
    code: 0,
    message: 'success',
    data: { stats }
  });
}));

/**
 * 手动触发全量容量校正
 * POST /api/system/maintenance/rebuild-quota-stats
 */
systemApp.post('/maintenance/rebuild-quota-stats', asyncHandler(async (req, res) => {
  (async () => {
    try {
      log.info('手动触发容量校正任务');
      await storageManager._rebuildAllQuotaStats();
      log.info('容量校正任务完成');
    } catch (err) {
      log.error({ err }, '容量校正任务失败');
    }
  })();

  return res.json({
    code: 0,
    message: '容量校正任务已在后台启动',
    data: { status: 'processing' }
  });
}));

/**
 * 获取容量校正历史记录
 * GET /api/system/maintenance/quota-history
 */
systemApp.get('/maintenance/quota-history', asyncHandler(async (req, res) => {
  const limit = Math.min(parseInt(req.query.limit || '10'), 100);
  const storageId = req.query.storage_id;

  let query = 'SELECT * FROM storage_quota_history';
  const params = [];

  if (storageId) {
    query += ' WHERE storage_id = ?';
    params.push(storageId);
  }

  query += ' ORDER BY recorded_at DESC LIMIT ?';
  params.push(limit);

  const history = sqlite.prepare(query).all(...params);

  return res.json({
    code: 0,
    message: 'success',
    data: { history }
  });
}));

/**
 * 获取响应缓存统计信息
 * GET /api/system/cache/stats
 */
systemApp.get('/cache/stats', asyncHandler(async (_req, res) => {
  const cache = getResponseCache();
  const stats = cache.getStats();

  return res.json({
    code: 0,
    message: 'success',
    data: stats
  });
}));

/**
 * 清空响应缓存
 * POST /api/system/cache/clear
 */
systemApp.post('/cache/clear', asyncHandler(async (_req, res) => {
  cacheInvalidation.invalidateAll();

  return res.json({
    code: 0,
    message: '缓存已清空'
  });
}));

export default systemApp;
