const { Hono } = require('hono');
const fs = require('fs');
const path = require('path');
const { adminAuth } = require('../middleware/auth');
const storageManager = require('../storage/manager');
const { db } = require('../database');

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
systemApp.get('/config', (c) => {
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
systemApp.get('/storages', (c) => {
  try {
    const raw = fs.readFileSync(configPath, 'utf8');
    const cfg = JSON.parse(raw);
    const list = (cfg.storage?.storages || []).map(maskStorage);
    return c.json({ code: 0, message: 'success', data: { list, default: cfg.storage?.default } });
  } catch (err) {
    return c.json({ code: 500, message: '读取存储渠道失败: ' + err.message }, 500);
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
systemApp.get('/load-balance', (c) => {
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
    const { strategy, scope, enabledTypes, weights } = body;

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
      config: storConfig
    };
    cfg.storage.storages = [...(cfg.storage.storages || []), newStorage];
    syncAllowedUploadChannels(cfg);
    fs.writeFileSync(configPath, JSON.stringify(cfg, null, 2), 'utf8');
    storageManager.reload();
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
    if (body.config !== undefined) {
      existing.config = existing.config || {};
      for (const [k, v] of Object.entries(body.config)) {
        // 敏感字段值为 null 时跳过覆盖（前端留空表示不修改）
        if (SENSITIVE_KEYS.includes(k) && v === null) continue;
        existing.config[k] = v;
      }
    }
    syncAllowedUploadChannels(cfg);
    fs.writeFileSync(configPath, JSON.stringify(cfg, null, 2), 'utf8');
    storageManager.reload();
    return c.json({ code: 0, message: '存储渠道已更新', data: maskStorage(existing) });
  } catch (err) {
    return c.json({ code: 500, message: '更新渠道失败: ' + err.message }, 500);
  }
});

/**
 * 删除存储渠道（不允许删除默认渠道）
 * DELETE /api/system/storages/:id
 */
systemApp.delete('/storages/:id', (c) => {
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
    syncAllowedUploadChannels(cfg);
    fs.writeFileSync(configPath, JSON.stringify(cfg, null, 2), 'utf8');
    storageManager.reload();
    return c.json({ code: 0, message: '存储渠道已删除' });
  } catch (err) {
    return c.json({ code: 500, message: '删除渠道失败: ' + err.message }, 500);
  }
});

/**
 * 设为默认存储渠道
 * PUT /api/system/storages/:id/default
 */
systemApp.put('/storages/:id/default', (c) => {
  try {
    const id = c.req.param('id');
    const raw = fs.readFileSync(configPath, 'utf8');
    const cfg = JSON.parse(raw);
    if (!(cfg.storage.storages || []).some((s) => s.id === id))
      return c.json({ code: 404, message: `渠道 "${id}" 不存在` }, 404);
    cfg.storage.default = id;
    fs.writeFileSync(configPath, JSON.stringify(cfg, null, 2), 'utf8');
    storageManager.reload();
    return c.json({ code: 0, message: `已将 "${id}" 设为默认渠道` });
  } catch (err) {
    return c.json({ code: 500, message: '设置默认渠道失败: ' + err.message }, 500);
  }
});

/**
 * 启用/禁用存储渠道
 * PUT /api/system/storages/:id/toggle
 */
systemApp.put('/storages/:id/toggle', (c) => {
  try {
    const id = c.req.param('id');
    const raw = fs.readFileSync(configPath, 'utf8');
    const cfg = JSON.parse(raw);
    const s = (cfg.storage.storages || []).find((s) => s.id === id);
    if (!s) return c.json({ code: 404, message: `渠道 "${id}" 不存在` }, 404);
    s.enabled = !s.enabled;
    syncAllowedUploadChannels(cfg);
    fs.writeFileSync(configPath, JSON.stringify(cfg, null, 2), 'utf8');
    storageManager.reload();
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
    // 从数据库统计每个渠道的已用容量
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

    const stats = {}; // { [instanceId]: totalBytes }

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
