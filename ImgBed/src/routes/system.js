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
  dashboardOverviewCache,
  dashboardUploadTrendCache,
  dashboardAccessStatsCache,
  cacheInvalidation
} from '../middleware/cache.js';
import { getResponseCache } from '../services/cache/response-cache.js';
import { getQuotaEventsArchive } from '../services/archive/quota-events-archive.js';
import { getArchiveScheduler } from '../services/archive/archive-scheduler.js';
import { success } from '../utils/response.js';

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
  return res.json(success(cfg));
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
    if (body.security.guestUploadEnabled !== undefined)
      cfg.security.guestUploadEnabled = Boolean(body.security.guestUploadEnabled);
    if (body.security.uploadPassword !== undefined)
      cfg.security.uploadPassword = String(body.security.uploadPassword);
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

  return res.json(success(null, '配置已保存，部分配置需重启服务后生效'));
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

  return res.json(success({ list, default: cfg.storage?.default }));
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
    return res.json(success(result, '连接成功'));
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
  return res.json(success({
    strategy: cfg.storage?.loadBalanceStrategy || 'default',
    scope: cfg.storage?.loadBalanceScope || 'global',
    enabledTypes: cfg.storage?.loadBalanceEnabledTypes || [],
    weights: cfg.storage?.loadBalanceWeights || {},
    failoverEnabled: cfg.storage?.failoverEnabled !== false,
    stats: storageManager.getUsageStats()
  }));
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

  return res.json(success(null, '负载均衡配置已更新'));
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

  return res.json(success(maskStorage(newStorage), '存储渠道已新增'));
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

  return res.json(success(maskStorage(existing), '存储渠道已更新'));
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

  return res.json(success(null, '存储渠道已删除'));
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

  return res.json(success(null, `已将 "${id}" 设为默认渠道`));
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

/**
 * 获取事件归档统计信息
 * GET /api/system/archive/stats
 */
systemApp.get('/archive/stats', asyncHandler(async (_req, res) => {
  const archive = getQuotaEventsArchive();
  const stats = archive.getStats();

  return res.json({
    code: 0,
    message: 'success',
    data: stats
  });
}));

/**
 * 手动触发归档任务
 * POST /api/system/archive/run
 */
systemApp.post('/archive/run', asyncHandler(async (_req, res) => {
  const scheduler = getArchiveScheduler();
  const result = await scheduler.runNow();

  if (result.skipped) {
    return res.json({
      code: 0,
      message: '归档任务正在执行中，已跳过本次触发',
      data: result
    });
  }

  return res.json({
    code: 0,
    message: '归档任务执行完成',
    data: result
  });
}));

/**
 * 获取归档调度器状态
 * GET /api/system/archive/scheduler
 */
systemApp.get('/archive/scheduler', asyncHandler(async (_req, res) => {
  const scheduler = getArchiveScheduler();
  const status = scheduler.getStatus();

  return res.json({
    code: 0,
    message: 'success',
    data: status
  });
}));

/**
 * 仪表盘 - 系统概览统计
 * GET /api/system/dashboard/overview
 */
systemApp.get('/dashboard/overview', dashboardOverviewCache(), asyncHandler(async (_req, res) => {
  // 查询总文件数
  const totalFilesResult = sqlite.prepare('SELECT COUNT(*) as count FROM files').get();
  const totalFiles = totalFilesResult?.count || 0;

  // 查询总存储大小
  const totalSizeResult = sqlite.prepare('SELECT SUM(size) as sum FROM files').get();
  const totalSize = totalSizeResult?.sum || 0;

  // 查询今日上传数
  const todayUploadsResult = sqlite.prepare(`
    SELECT COUNT(*) as count FROM files
    WHERE DATE(created_at) = DATE('now')
  `).get();
  const todayUploads = todayUploadsResult?.count || 0;

  // 查询今日访问次数
  const todayAccessResult = sqlite.prepare(`
    SELECT COUNT(*) as count FROM access_logs
    WHERE DATE(created_at) = DATE('now')
  `).get();
  const todayAccess = todayAccessResult?.count || 0;

  // 查询存储渠道数
  const channelsResult = sqlite.prepare(`
    SELECT
      COUNT(*) as total,
      SUM(CASE WHEN enabled = 1 THEN 1 ELSE 0 END) as enabled
    FROM storage_channels
  `).get();
  const totalChannels = channelsResult?.total || 0;
  const enabledChannels = channelsResult?.enabled || 0;

  return res.json({
    code: 0,
    message: 'success',
    data: {
      totalFiles,
      totalSize,
      todayUploads,
      todayAccess,
      totalChannels,
      enabledChannels
    }
  });
}));

/**
 * 仪表盘 - 上传趋势统计
 * GET /api/system/dashboard/upload-trend?days=7
 */
systemApp.get('/dashboard/upload-trend', dashboardUploadTrendCache(), asyncHandler(async (req, res) => {
  const days = parseInt(req.query.days) || 7;

  // 验证参数
  if (![7, 30, 90].includes(days)) {
    throw new ValidationError('days 参数必须是 7、30 或 90');
  }

  const trend = sqlite.prepare(`
    SELECT
      DATE(created_at) as date,
      COUNT(*) as fileCount,
      COALESCE(SUM(size), 0) as totalSize
    FROM files
    WHERE created_at >= datetime('now', '-${days} days')
    GROUP BY DATE(created_at)
    ORDER BY date ASC
  `).all();

  return res.json({
    code: 0,
    message: 'success',
    data: { trend }
  });
}));

/**
 * 仪表盘 - 访问统计
 * GET /api/system/dashboard/access-stats
 */
systemApp.get('/dashboard/access-stats', dashboardAccessStatsCache(), asyncHandler(async (_req, res) => {
  // 今日访问次数（排除管理员访问）
  const todayAccessResult = sqlite.prepare(`
    SELECT COUNT(*) as count FROM access_logs
    WHERE DATE(created_at) = DATE('now') AND (is_admin = 0 OR is_admin IS NULL)
  `).get();
  const todayAccess = todayAccessResult?.count || 0;

  // 今日独立访客数（排除管理员访问）
  const todayVisitorsResult = sqlite.prepare(`
    SELECT COUNT(DISTINCT ip) as count FROM access_logs
    WHERE DATE(created_at) = DATE('now') AND (is_admin = 0 OR is_admin IS NULL)
  `).get();
  const todayVisitors = todayVisitorsResult?.count || 0;

  // 热门文件 TOP 5（排除管理员访问）
  const topFiles = sqlite.prepare(`
    SELECT
      access_logs.file_id as fileId,
      files.file_name as fileName,
      files.original_name as originalName,
      COUNT(access_logs.id) as accessCount
    FROM access_logs
    INNER JOIN files ON access_logs.file_id = files.id
    WHERE DATE(access_logs.created_at) >= DATE('now', '-7 days')
      AND (access_logs.is_admin = 0 OR access_logs.is_admin IS NULL)
    GROUP BY access_logs.file_id
    ORDER BY accessCount DESC
    LIMIT 5
  `).all();

  // 近7天访问趋势（排除管理员访问）
  const accessTrend = sqlite.prepare(`
    SELECT
      DATE(created_at) as date,
      COUNT(*) as accessCount
    FROM access_logs
    WHERE created_at >= datetime('now', '-7 days')
      AND (is_admin = 0 OR is_admin IS NULL)
    GROUP BY DATE(created_at)
    ORDER BY date ASC
  `).all();

  return res.json({
    code: 0,
    message: 'success',
    data: {
      todayAccess,
      todayVisitors,
      topFiles,
      accessTrend
    }
  });
}));

export default systemApp;
