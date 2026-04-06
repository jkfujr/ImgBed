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

const systemApp = express.Router();
const configPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../config.json');

// 敏感字段列表
const SENSITIVE_KEYS = ['secretAccessKey', 'botToken', 'token', 'webhookUrl', 'authHeader'];

// 合法的存储类型
const VALID_TYPES = ['local', 's3', 'telegram', 'discord', 'huggingface', 'external'];

/**
 * 对存储渠道的敏感 config 字段进行脱敏处理
 */
function maskStorage(s) {
  const masked = { ...s, config: { ...(s.config || {}) } };
  for (const k of SENSITIVE_KEYS) {
    if (masked.config[k] !== undefined) masked.config[k] = '***';
  }
  return masked;
}

// 需要管理员权限
systemApp.use(adminAuth);

/**
 * 读取系统配置（脱敏：隐藏 jwt.secret）
 * GET /api/system/config
 */
systemApp.get('/config', async (_req, res) => {
  try {
    const cfg = readSystemConfig(configPath);
    // 隐藏敏感字段
    if (cfg.jwt) cfg.jwt.secret = '******';
    return res.json({ code: 0, message: 'success', data: cfg });
  } catch (err) {
    return res.status(500).json({ code: 500, message: '读取配置文件失败: ' + err.message });
  }
});

/**
 * 更新系统配置（仅允许修改部分安全字段）
 * PUT /api/system/config
 * 支持字段: server.port / security.corsOrigin / security.maxFileSize / storage.default
 */
systemApp.put('/config', async (req, res) => {
  try {
    const body = req.body || {};
    const cfg = readSystemConfig(configPath);

    // 仅允许修改指定的安全子集
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

    writeSystemConfig(configPath, cfg);
    return res.json({ code: 0, message: '配置已保存，部分配置需重启服务后生效' });
  } catch (err) {
    return res.status(500).json({ code: 500, message: '保存配置失败: ' + err.message });
  }
});

/**
 * 获取存储渠道列表（含完整 config，敏感字段脱敏）
 * GET /api/system/storages
 */
systemApp.get('/storages', async (_req, res) => {
  try {
    const cfg = readSystemConfig(configPath);
    const fileStorages = cfg.storage?.storages || [];
    const quotaStats = storageManager.getAllQuotaStats();

    // 从数据库读取元数据
    const dbChannels = sqlite.prepare('SELECT * FROM storage_channels').all();
    const dbMap = new Map(dbChannels.map(ch => [ch.id, ch]));

    // 合并数据
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
  } catch (err) {
    return res.status(500).json({ code: 500, message: '读取存储渠道失败: ' + err.message });
  }
});

/**
 * 获取存储渠道统计信息
 * GET /api/system/storages/stats
 */
systemApp.get('/storages/stats', async (_req, res) => {
  try {
    const cfg = readSystemConfig(configPath);
    const fileStorages = cfg.storage?.storages || [];

    // 从数据库读取元数据
    const dbChannels = sqlite.prepare('SELECT * FROM storage_channels').all();
    const dbMap = new Map(dbChannels.map(ch => [ch.id, ch]));

    // 统计数据
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
  } catch (err) {
    return res.status(500).json({ code: 500, message: '读取统计信息失败: ' + err.message });
  }
});

/**
 * 测试存储渠道连接（临时创建实例，不修改配置）
 * POST /api/system/storages/test
 * Body: { type: string, config: object }
 */
systemApp.post('/storages/test', async (req, res) => {
  try {
    const { type, config: storageConfig } = req.body || {};

    if (!type || !VALID_TYPES.includes(type)) {
      return res.status(400).json({ code: 400, message: `不支持的存储类型: ${type}` });
    }

    // 调用管理器测试连接
    const result = await storageManager.testConnection(type, storageConfig || {});
    if (result.ok) {
      return res.json({ code: 0, message: '连接成功', data: result });
    } else {
      return res.status(400).json({ code: 400, message: result.message });
    }
  } catch (err) {
    return res.status(500).json({ code: 500, message: '测试连接失败: ' + err.message });
  }
});

/**
 * 获取负载均衡配置
 * GET /api/system/load-balance
 */
systemApp.get('/load-balance', async (_req, res) => {
  try {
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
  } catch (err) {
    return res.status(500).json({ code: 500, message: '读取负载均衡配置失败: ' + err.message });
  }
});

/**
 * 更新负载均衡配置
 * PUT /api/system/load-balance
 */
systemApp.put('/load-balance', async (req, res) => {
  try {
    const body = req.body || {};
    const cfg = readSystemConfig(configPath);

    const validationError = updateLoadBalanceConfig(cfg, body);
    if (validationError) {
      return res.status(validationError.code).json(validationError);
    }

    writeSystemConfig(configPath, cfg);
    await storageManager.reload();

    return res.json({ code: 0, message: '负载均衡配置已更新' });
  } catch (err) {
    return res.status(500).json({ code: 500, message: '更新负载均衡配置失败: ' + err.message });
  }
});

/**
 * 新增存储渠道
 * POST /api/system/storages
 */
systemApp.post('/storages', async (req, res) => {
  try {
    const body = req.body || {};

    const validationError = validateStorageChannelInput(body, VALID_TYPES);
    if (validationError) {
      return res.status(validationError.code).json(validationError);
    }

    const cfg = readSystemConfig(configPath);

    if ((cfg.storage.storages || []).some((s) => s.id === body.id))
      return res.status(400).json({ code: 400, message: `渠道 ID "${body.id}" 已存在` });

    const newStorage = buildNewStorageChannel(body);
    cfg.storage.storages = [...(cfg.storage.storages || []), newStorage];

    await insertStorageChannelMeta(newStorage, sqlite);
    await applyStorageConfigChange({ cfg, configPath, storageManager });

    return res.json({ code: 0, message: '存储渠道已新增', data: maskStorage(newStorage) });
  } catch (err) {
    return res.status(500).json({ code: 500, message: '新增渠道失败: ' + err.message });
  }
});

/**
 * 编辑存储渠道
 * PUT /api/system/storages/:id
 */
systemApp.put('/storages/:id', async (req, res) => {
  try {
    const id = req.params.id;
    const body = req.body || {};
    const cfg = readSystemConfig(configPath);
    const idx = (cfg.storage.storages || []).findIndex((s) => s.id === id);
    if (idx === -1) return res.status(404).json({ code: 404, message: `渠道 "${id}" 不存在` });

    const existing = cfg.storage.storages[idx];
    applyStorageFieldUpdates(existing, body);

    if (body.config !== undefined) {
      existing.config = existing.config || {};
      for (const [k, v] of Object.entries(body.config)) {
        // 敏感字段值为 null 时跳过覆盖（前端留空表示不修改）
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

    return res.json({ code: 0, message: '存储渠道已更新', data: maskStorage(existing) });
  } catch (err) {
    return res.status(500).json({ code: 500, message: '更新渠道失败: ' + err.message });
  }
});

/**
 * 删除存储渠道（不允许删除默认渠道）
 * DELETE /api/system/storages/:id
 */
systemApp.delete('/storages/:id', async (req, res) => {
  try {
    const id = req.params.id;
    const cfg = readSystemConfig(configPath);
    if (cfg.storage.default === id)
      return res.status(400).json({ code: 400, message: '不能删除当前默认渠道，请先切换默认渠道' });
    const before = (cfg.storage.storages || []).length;
    cfg.storage.storages = (cfg.storage.storages || []).filter((s) => s.id !== id);
    if (cfg.storage.storages.length === before)
      return res.status(404).json({ code: 404, message: `渠道 "${id}" 不存在` });

    await deleteStorageChannelMeta(id, sqlite);
    await applyStorageConfigChange({ cfg, configPath, storageManager });

    return res.json({ code: 0, message: '存储渠道已删除' });
  } catch (err) {
    return res.status(500).json({ code: 500, message: '删除渠道失败: ' + err.message });
  }
});

/**
 * 设为默认存储渠道
 * PUT /api/system/storages/:id/default
 */
systemApp.put('/storages/:id/default', async (req, res) => {
  try {
    const id = req.params.id;
    const cfg = readSystemConfig(configPath);
    if (!(cfg.storage.storages || []).some((s) => s.id === id))
      return res.status(404).json({ code: 404, message: `渠道 "${id}" 不存在` });
    cfg.storage.default = id;
    writeSystemConfig(configPath, cfg);
    await storageManager.reload();
    return res.json({ code: 0, message: `已将 "${id}" 设为默认渠道` });
  } catch (err) {
    return res.status(500).json({ code: 500, message: '设置默认渠道失败: ' + err.message });
  }
});

/**
 * 启用/禁用存储渠道
 * PUT /api/system/storages/:id/toggle
 */
systemApp.put('/storages/:id/toggle', async (req, res) => {
  try {
    const id = req.params.id;
    const cfg = readSystemConfig(configPath);
    const storage = (cfg.storage.storages || []).find((s) => s.id === id);
    if (!storage) return res.status(404).json({ code: 404, message: `渠道 "${id}" 不存在` });

    storage.enabled = !storage.enabled;

    await updateStorageChannelMeta(id, storage, sqlite);
    await applyStorageConfigChange({ cfg, configPath, storageManager });

    return res.json({
      code: 0,
      message: `渠道 "${id}" 已${storage.enabled ? '启用' : '禁用'}`,
      data: { enabled: storage.enabled }
    });
  } catch (err) {
    return res.status(500).json({ code: 500, message: '切换渠道状态失败: ' + err.message });
  }
});

/**
 * 获取各存储渠道已用容量统计
 * GET /api/system/quota-stats
 * 按渠道 ID 统计已用字节总数
 */
systemApp.get('/quota-stats', async (_req, res) => {
  try {
    const stats = storageManager.getAllQuotaStats();
    return res.json({
      code: 0,
      message: 'success',
      data: { stats }
    });
  } catch (err) {
    return res.status(500).json({
      code: 500,
      message: '获取容量统计失败: ' + err.message
    });
  }
});

/**
 * 手动触发全量容量校正
 * POST /api/system/maintenance/rebuild-quota-stats
 * 后台异步执行，立即返回
 */
systemApp.post('/maintenance/rebuild-quota-stats', async (req, res) => {
  try {
    // 后台异步执行，不阻塞响应
    (async () => {
      try {
        console.log('[Maintenance] 手动触发容量校正任务...');
        await storageManager._rebuildAllQuotaStats();
        console.log('[Maintenance] 容量校正任务完成');
      } catch (err) {
        console.error('[Maintenance] 容量校正任务失败:', err);
      }
    })();

    return res.json({
      code: 0,
      message: '容量校正任务已在后台启动',
      data: { status: 'processing' }
    });
  } catch (err) {
    return res.status(500).json({
      code: 500,
      message: '启动容量校正任务失败: ' + err.message
    });
  }
});

/**
 * 获取容量校正历史记录
 * GET /api/system/maintenance/quota-history
 * Query: ?limit=10&storage_id=xxx
 */
systemApp.get('/maintenance/quota-history', async (req, res) => {
  try {
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
  } catch (err) {
    return res.status(500).json({
      code: 500,
      message: '获取历史记录失败: ' + err.message
    });
  }
});

export default systemApp;
