const { Hono } = require('hono');
const fs = require('fs');
const path = require('path');
const { adminAuth } = require('../middleware/auth');
const storageManager = require('../storage/manager');
const { db } = require('../database');
const config = require('../config');

const systemApp = new Hono();
const configPath = path.resolve(__dirname, '../../config.json');

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

/**
 * 根据 allowUpload 和 enabled 自动重新计算 allowedUploadChannels
 */
function syncAllowedUploadChannels(cfg) {
  cfg.storage.allowedUploadChannels = (cfg.storage.storages || [])
    .filter((s) => s.allowUpload && s.enabled)
    .map((s) => s.id);
}

// 需要管理员权限
systemApp.use('*', adminAuth);

/**
 * 读取系统配置（脱敏：隐藏 jwt.secret）
 * GET /api/system/config
 */
systemApp.get('/config', async (c) => {
  try {
    const raw = fs.readFileSync(configPath, 'utf8');
    const cfg = JSON.parse(raw);
    // 隐藏敏感字段
    if (cfg.jwt) cfg.jwt.secret = '******';
    return c.json({ code: 0, message: 'success', data: cfg });
  } catch (err) {
    return c.json({ code: 500, message: '读取配置文件失败: ' + err.message }, 500);
  }
});

/**
 * 更新系统配置（仅允许修改部分安全字段）
 * PUT /api/system/config
 * 支持字段: server.port / security.corsOrigin / security.maxFileSize / storage.default
 */
systemApp.put('/config', async (c) => {
  try {
    const body = await c.req.json();
    const raw = fs.readFileSync(configPath, 'utf8');
    const cfg = JSON.parse(raw);

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
    // 支持修改上传配置
    if (body.upload !== undefined) {
      if (body.upload.quotaCheckMode !== undefined) {
        cfg.upload = cfg.upload || {};
        cfg.upload.quotaCheckMode = String(body.upload.quotaCheckMode);
      }
      if (body.upload.fullCheckIntervalHours !== undefined) {
        cfg.upload = cfg.upload || {};
        cfg.upload.fullCheckIntervalHours = Math.max(1, Number(body.upload.fullCheckIntervalHours) || 6);
      }
      if (body.upload.defaultSizeLimitMB !== undefined) {
        cfg.upload = cfg.upload || {};
        cfg.upload.defaultSizeLimitMB = Number(body.upload.defaultSizeLimitMB) || 10;
      }
      if (body.upload.defaultChunkSizeMB !== undefined) {
        cfg.upload = cfg.upload || {};
        cfg.upload.defaultChunkSizeMB = Number(body.upload.defaultChunkSizeMB) || 5;
      }
      if (body.upload.defaultMaxChunks !== undefined) {
        cfg.upload = cfg.upload || {};
        cfg.upload.defaultMaxChunks = Number(body.upload.defaultMaxChunks) || 0;
      }
      if (body.upload.defaultMaxLimitMB !== undefined) {
        cfg.upload = cfg.upload || {};
        cfg.upload.defaultMaxLimitMB = Number(body.upload.defaultMaxLimitMB) || 100;
      }
      // 上传限制开关
      if (body.upload.enableSizeLimit !== undefined) {
        cfg.upload = cfg.upload || {};
        cfg.upload.enableSizeLimit = Boolean(body.upload.enableSizeLimit);
      }
      if (body.upload.enableChunking !== undefined) {
        cfg.upload = cfg.upload || {};
        cfg.upload.enableChunking = Boolean(body.upload.enableChunking);
      }
      if (body.upload.enableMaxLimit !== undefined) {
        cfg.upload = cfg.upload || {};
        cfg.upload.enableMaxLimit = Boolean(body.upload.enableMaxLimit);
      }
    }

    fs.writeFileSync(configPath, JSON.stringify(cfg, null, 2), 'utf8');
    return c.json({ code: 0, message: '配置已保存，部分配置需重启服务后生效' });
  } catch (err) {
    return c.json({ code: 500, message: '保存配置失败: ' + err.message }, 500);
  }
});

/**
 * 获取存储渠道列表（含完整 config，敏感字段脱敏）
 * GET /api/system/storages
 */
systemApp.get('/storages', async (c) => {
  try {
    const raw = fs.readFileSync(configPath, 'utf8');
    const cfg = JSON.parse(raw);
    const fileStorages = cfg.storage?.storages || [];
    const quotaStats = storageManager.getAllQuotaStats();

    // 从数据库读取元数据
    const dbChannels = await db.selectFrom('storage_channels').selectAll().execute();
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

    return c.json({ code: 0, message: 'success', data: { list, default: cfg.storage?.default } });
  } catch (err) {
    return c.json({ code: 500, message: '读取存储渠道失败: ' + err.message }, 500);
  }
});

/**
 * 获取存储渠道统计信息
 * GET /api/system/storages/stats
 */
systemApp.get('/storages/stats', async (c) => {
  try {
    const raw = fs.readFileSync(configPath, 'utf8');
    const cfg = JSON.parse(raw);
    const fileStorages = cfg.storage?.storages || [];

    // 从数据库读取元数据
    const dbChannels = await db.selectFrom('storage_channels').selectAll().execute();
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

    return c.json({
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
    return c.json({ code: 500, message: '读取统计信息失败: ' + err.message }, 500);
  }
});

/**
 * 测试存储渠道连接（临时创建实例，不修改配置）
 * POST /api/system/storages/test
 * Body: { type: string, config: object }
 */
systemApp.post('/storages/test', async (c) => {
  try {
    const { type, config: storageConfig } = await c.req.json();

    if (!type || !VALID_TYPES.includes(type)) {
      return c.json({ code: 400, message: `不支持的存储类型: ${type}` }, 400);
    }

    // 调用管理器测试连接
    const result = await storageManager.testConnection(type, storageConfig || {});
    if (result.ok) {
      return c.json({ code: 0, message: '连接成功', data: result });
    } else {
      return c.json({ code: 400, message: result.message }, 400);
    }
  } catch (err) {
    return c.json({ code: 500, message: '测试连接失败: ' + err.message }, 500);
  }
});

/**
 * 获取负载均衡配置
 * GET /api/system/load-balance
 */
systemApp.get('/load-balance', async (c) => {
  try {
    const raw = fs.readFileSync(configPath, 'utf8');
    const cfg = JSON.parse(raw);
    return c.json({
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
    return c.json({ code: 500, message: '读取负载均衡配置失败: ' + err.message }, 500);
  }
});

/**
 * 更新负载均衡配置
 * PUT /api/system/load-balance
 */
systemApp.put('/load-balance', async (c) => {
  try {
    const body = await c.req.json();
    const { strategy, scope, enabledTypes, weights, failoverEnabled } = body;

    const raw = fs.readFileSync(configPath, 'utf8');
    const cfg = JSON.parse(raw);

    if (!cfg.storage) cfg.storage = {};

    if (strategy !== undefined) {
      const validStrategies = ['default', 'round-robin', 'random', 'least-used', 'weighted'];
      if (!validStrategies.includes(strategy)) {
        return c.json({ code: 400, message: `无效的策略: ${strategy}` }, 400);
      }
      cfg.storage.loadBalanceStrategy = strategy;
    }

    if (scope !== undefined) {
      cfg.storage.loadBalanceScope = scope;
    }
    if (enabledTypes !== undefined) {
      cfg.storage.loadBalanceEnabledTypes = enabledTypes;
    }

    if (weights !== undefined) {
      cfg.storage.loadBalanceWeights = weights;
    }

    if (failoverEnabled !== undefined) {
      cfg.storage.failoverEnabled = Boolean(failoverEnabled);
    }

    fs.writeFileSync(configPath, JSON.stringify(cfg, null, 2), 'utf8');
    storageManager.reload();

    return c.json({ code: 0, message: '负载均衡配置已更新' });
  } catch (err) {
    return c.json({ code: 500, message: '更新负载均衡配置失败: ' + err.message }, 500);
  }
});

/**
 * 新增存储渠道
 * POST /api/system/storages
 */
systemApp.post('/storages', async (c) => {
  try {
    const body = await c.req.json();
    const {
      id, type, name, enabled = true, allowUpload = false,
      weight = 1,
      enableQuota,
      quotaLimitGB,
      disableThresholdPercent,
      config: storConfig = {}
    } = body;

    if (!id || !/^[a-zA-Z0-9-]+$/.test(id))
      return c.json({ code: 400, message: 'id 不合法，仅允许字母、数字、连字符' }, 400);
    if (!VALID_TYPES.includes(type))
      return c.json({ code: 400, message: `type 不合法，支持：${VALID_TYPES.join(', ')}` }, 400);
    if (!name || !name.trim())
      return c.json({ code: 400, message: 'name 不能为空' }, 400);

    const raw = fs.readFileSync(configPath, 'utf8');
    const cfg = JSON.parse(raw);

    if ((cfg.storage.storages || []).some((s) => s.id === id))
      return c.json({ code: 400, message: `渠道 ID "${id}" 已存在` }, 400);

    const newStorage = {
      id, type, name,
      enabled: Boolean(enabled),
      allowUpload: Boolean(allowUpload),
      weight: body.weight ?? 1,
      // 配额处理 - enableQuota=false 时存 null 表示不限制
      quotaLimitGB: enableQuota ? Number(quotaLimitGB) || 10 : null,
      disableThresholdPercent: enableQuota ? (Math.max(1, Math.min(100, Number(disableThresholdPercent) || 95))) : 95,
      // 大小限制
      enableSizeLimit: Boolean(body.enableSizeLimit),
      sizeLimitMB: Number(body.sizeLimitMB) || 10,
      // 分片上传
      enableChunking: Boolean(body.enableChunking),
      chunkSizeMB: Number(body.chunkSizeMB) || 5,
      maxChunks: Number(body.maxChunks) || 0,
      // 最大限制
      enableMaxLimit: Boolean(body.enableMaxLimit),
      maxLimitMB: Number(body.maxLimitMB) || 100,
      config: storConfig
    };
    cfg.storage.storages = [...(cfg.storage.storages || []), newStorage];
    syncAllowedUploadChannels(cfg);

    // 插入数据库
    await db.insertInto('storage_channels')
      .values({
        id: newStorage.id,
        name: newStorage.name,
        type: newStorage.type,
        enabled: newStorage.enabled ? 1 : 0,
        allow_upload: newStorage.allowUpload ? 1 : 0,
        weight: newStorage.weight,
        quota_limit_gb: newStorage.quotaLimitGB
      })
      .execute();

    fs.writeFileSync(configPath, JSON.stringify(cfg, null, 2), 'utf8');
    await storageManager.reload();
    return c.json({ code: 0, message: '存储渠道已新增', data: maskStorage(newStorage) });
  } catch (err) {
    return c.json({ code: 500, message: '新增渠道失败: ' + err.message }, 500);
  }
});

/**
 * 编辑存储渠道
 * PUT /api/system/storages/:id
 */
systemApp.put('/storages/:id', async (c) => {
  try {
    const id = c.req.param('id');
    const body = await c.req.json();
    const raw = fs.readFileSync(configPath, 'utf8');
    const cfg = JSON.parse(raw);
    const idx = (cfg.storage.storages || []).findIndex((s) => s.id === id);
    if (idx === -1) return c.json({ code: 404, message: `渠道 "${id}" 不存在` }, 404);

    const existing = cfg.storage.storages[idx];
    if (body.name !== undefined) existing.name = String(body.name).trim();
    if (body.enabled !== undefined) existing.enabled = Boolean(body.enabled);
    if (body.allowUpload !== undefined) existing.allowUpload = Boolean(body.allowUpload);
    if (body.weight !== undefined) existing.weight = Number(body.weight) || 1;
    // 配额字段处理
    if (body.enableQuota !== undefined) {
      if (body.enableQuota) {
        existing.quotaLimitGB = Number(body.quotaLimitGB) || 10;
        existing.disableThresholdPercent = Math.max(1, Math.min(100, Number(body.disableThresholdPercent) || 95));
      } else {
        existing.quotaLimitGB = null;
      }
    }
    // 大小限制字段
    if (body.enableSizeLimit !== undefined) existing.enableSizeLimit = Boolean(body.enableSizeLimit);
    if (body.sizeLimitMB !== undefined) existing.sizeLimitMB = Number(body.sizeLimitMB) || 10;
    // 分片上传字段
    if (body.enableChunking !== undefined) existing.enableChunking = Boolean(body.enableChunking);
    if (body.chunkSizeMB !== undefined) existing.chunkSizeMB = Number(body.chunkSizeMB) || 5;
    if (body.maxChunks !== undefined) existing.maxChunks = Number(body.maxChunks) || 0;
    // 最大限制字段
    if (body.enableMaxLimit !== undefined) existing.enableMaxLimit = Boolean(body.enableMaxLimit);
    if (body.maxLimitMB !== undefined) existing.maxLimitMB = Number(body.maxLimitMB) || 100;
    if (body.config !== undefined) {
      existing.config = existing.config || {};
      for (const [k, v] of Object.entries(body.config)) {
        // 敏感字段值为 null 时跳过覆盖（前端留空表示不修改）
        if (SENSITIVE_KEYS.includes(k) && v === null) continue;
        existing.config[k] = v;
      }
    }

    // 更新数据库元数据
    await db.updateTable('storage_channels')
      .set({
        name: existing.name,
        enabled: existing.enabled ? 1 : 0,
        allow_upload: existing.allowUpload ? 1 : 0,
        weight: existing.weight,
        quota_limit_gb: existing.quotaLimitGB
      })
      .where('id', '=', id)
      .execute();

    syncAllowedUploadChannels(cfg);
    fs.writeFileSync(configPath, JSON.stringify(cfg, null, 2), 'utf8');
    await storageManager.reload();
    return c.json({ code: 0, message: '存储渠道已更新', data: maskStorage(existing) });
  } catch (err) {
    return c.json({ code: 500, message: '更新渠道失败: ' + err.message }, 500);
  }
});

/**
 * 删除存储渠道（不允许删除默认渠道）
 * DELETE /api/system/storages/:id
 */
systemApp.delete('/storages/:id', async (c) => {
  try {
    const id = c.req.param('id');
    const raw = fs.readFileSync(configPath, 'utf8');
    const cfg = JSON.parse(raw);
    if (cfg.storage.default === id)
      return c.json({ code: 400, message: '不能删除当前默认渠道，请先切换默认渠道' }, 400);
    const before = (cfg.storage.storages || []).length;
    cfg.storage.storages = (cfg.storage.storages || []).filter((s) => s.id !== id);
    if (cfg.storage.storages.length === before)
      return c.json({ code: 404, message: `渠道 "${id}" 不存在` }, 404);

    // 从数据库删除
    await db.deleteFrom('storage_channels').where('id', '=', id).execute();
    // 同时也删除历史记录
    await db.deleteFrom('storage_quota_history').where('storage_id', '=', id).execute();

    syncAllowedUploadChannels(cfg);
    fs.writeFileSync(configPath, JSON.stringify(cfg, null, 2), 'utf8');
    await storageManager.reload();
    return c.json({ code: 0, message: '存储渠道已删除' });
  } catch (err) {
    return c.json({ code: 500, message: '删除渠道失败: ' + err.message }, 500);
  }
});

/**
 * 设为默认存储渠道
 * PUT /api/system/storages/:id/default
 */
systemApp.put('/storages/:id/default', async (c) => {
  try {
    const id = c.req.param('id');
    const raw = fs.readFileSync(configPath, 'utf8');
    const cfg = JSON.parse(raw);
    if (!(cfg.storage.storages || []).some((s) => s.id === id))
      return c.json({ code: 404, message: `渠道 "${id}" 不存在` }, 404);
    cfg.storage.default = id;
    fs.writeFileSync(configPath, JSON.stringify(cfg, null, 2), 'utf8');
    await storageManager.reload();
    return c.json({ code: 0, message: `已将 "${id}" 设为默认渠道` });
  } catch (err) {
    return c.json({ code: 500, message: '设置默认渠道失败: ' + err.message }, 500);
  }
});

/**
 * 启用/禁用存储渠道
 * PUT /api/system/storages/:id/toggle
 */
systemApp.put('/storages/:id/toggle', async (c) => {
  try {
    const id = c.req.param('id');
    const raw = fs.readFileSync(configPath, 'utf8');
    const cfg = JSON.parse(raw);
    const s = (cfg.storage.storages || []).find((s) => s.id === id);
    if (!s) return c.json({ code: 404, message: `渠道 "${id}" 不存在` }, 404);
    s.enabled = !s.enabled;

    // 更新数据库
    await db.updateTable('storage_channels')
      .set({ enabled: s.enabled ? 1 : 0 })
      .where('id', '=', id)
      .execute();

    syncAllowedUploadChannels(cfg);
    fs.writeFileSync(configPath, JSON.stringify(cfg, null, 2), 'utf8');
    await storageManager.reload();
    return c.json({ code: 0, message: `渠道已${s.enabled ? '启用' : '禁用'}`, data: { enabled: s.enabled } });
  } catch (err) {
    return c.json({ code: 500, message: '切换渠道状态失败: ' + err.message }, 500);
  }
});

/**
 * 获取各存储渠道已用容量统计
 * GET /api/system/quota-stats
 * 按渠道 ID 统计已用字节总数
 */
systemApp.get('/quota-stats', async (c) => {
  try {
    // 如果是 always 模式，强制从数据库全量统计
    const mode = config.upload?.quotaCheckMode || 'auto';
    let stats;

    if (mode === 'always') {
      // 全量从数据库统计
      const result = await db
        .selectFrom('files')
        .select(['size', 'storage_config', 'storage_channel'])
        .execute();

      // 读取配置获取渠道列表，用于兼容旧文件统计
      const raw = fs.readFileSync(configPath, 'utf8');
      const cfg = JSON.parse(raw);
      const channels = cfg.storage?.storages || [];

      // 按类型分组，统计每个类型下的渠道ID列表
      const channelsByType = {};
      for (const ch of channels) {
        if (!channelsByType[ch.type]) {
          channelsByType[ch.type] = [];
        }
        channelsByType[ch.type].push(ch.id);
      }

      stats = {}; // { [instanceId]: totalBytes }

      for (const row of result) {
        let cfg;
        try {
          cfg = JSON.parse(row.storage_config || '{}');
        } catch (e) { continue; }
        const instanceId = cfg.instance_id;
        const fileSize = Number(row.size) || 0;

        if (instanceId) {
          // 情况1：已有 instance_id，直接统计
          stats[instanceId] = (stats[instanceId] || 0) + fileSize;
        } else {
          // 情况2：旧文件没有 instance_id，尝试根据类型推断
          // 如果该类型只有一个渠道，则归到这个渠道
          const type = row.storage_channel;
          if (type && channelsByType[type] && channelsByType[type].length === 1) {
            const fallbackId = channelsByType[type][0];
            stats[fallbackId] = (stats[fallbackId] || 0) + fileSize;
          }
        }
      }
    } else {
      // 自动模式：从缓存读取
      stats = storageManager.getAllQuotaStats();
    }

    return c.json({
      code: 0,
      message: 'success',
      data: {
        stats: stats
      }
    });
  } catch (err) {
    return c.json({
      code: 500,
      message: '获取容量统计失败: ' + err.message
    }, 500);
  }
});

module.exports = systemApp;
