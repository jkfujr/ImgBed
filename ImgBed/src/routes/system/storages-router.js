import express from 'express';

import asyncHandler from '../../middleware/asyncHandler.js';
import { success } from '../../utils/response.js';

function createSystemStoragesRouter({
  storagesListCache,
  storagesStatsCache,
  loadBalanceCache,
  quotaStatsCache,
  readRuntimeConfig,
  sanitizeStorageChannel,
  summarizeStorages,
  storageManager,
  storageConfigService,
} = {}) {
  const router = express.Router();

  router.get('/storages', storagesListCache(), asyncHandler(async (_req, res) => {
    const config = readRuntimeConfig();
    const storages = config.storage?.storages || [];
    const quotaStats = storageManager.getAllQuotaStats();

    return res.json(success({
      list: storages.map((storage) => sanitizeStorageChannel({
        ...storage,
        usedBytes: quotaStats[storage.id] || 0,
      })),
      default: config.storage?.default,
    }));
  }));

  router.get('/storages/stats', storagesStatsCache(), asyncHandler(async (_req, res) => {
    const config = readRuntimeConfig();
    return res.json(success(summarizeStorages(config.storage?.storages || [])));
  }));

  router.post('/storages/test', asyncHandler(async (req, res) => {
    const { type, config: storageConfig } = req.body || {};
    const result = await storageConfigService.testStorageConnection(type, storageConfig || {});
    return res.json(success(result, '连接成功'));
  }));

  router.get('/load-balance', loadBalanceCache(), asyncHandler(async (_req, res) => {
    const config = readRuntimeConfig();
    return res.json(success({
      strategy: config.storage?.loadBalanceStrategy || 'default',
      scope: config.storage?.loadBalanceScope || 'global',
      enabledTypes: config.storage?.loadBalanceEnabledTypes || [],
      weights: config.storage?.loadBalanceWeights || {},
      failoverEnabled: config.storage?.failoverEnabled !== false,
      stats: storageManager.getUsageStats(),
    }));
  }));

  router.put('/load-balance', asyncHandler(async (req, res) => {
    await storageConfigService.updateLoadBalance(req.body || {});
    return res.json(success(null, '负载均衡配置已更新'));
  }));

  router.post('/storages', asyncHandler(async (req, res) => {
    const storage = await storageConfigService.createStorage(req.body || {});
    return res.json(success(sanitizeStorageChannel(storage), '存储渠道已新增'));
  }));

  router.put('/storages/:id', asyncHandler(async (req, res) => {
    const storage = await storageConfigService.updateStorage(req.params.id, req.body || {});
    return res.json(success(sanitizeStorageChannel(storage), '存储渠道已更新'));
  }));

  router.delete('/storages/:id', asyncHandler(async (req, res) => {
    await storageConfigService.deleteStorage(req.params.id);
    return res.json(success(null, '存储渠道已删除，关联文件已冻结'));
  }));

  router.put('/storages/:id/default', asyncHandler(async (req, res) => {
    const id = req.params.id;
    await storageConfigService.setDefaultStorage(id);
    return res.json(success(null, `已将 "${id}" 设为默认渠道`));
  }));

  router.put('/storages/:id/toggle', asyncHandler(async (req, res) => {
    const id = req.params.id;
    const enabled = await storageConfigService.toggleStorage(id);
    return res.json(success(
      { enabled },
      `渠道 "${id}" 已${enabled ? '启用' : '禁用'}`,
    ));
  }));

  router.get('/quota-stats', quotaStatsCache(), asyncHandler(async (_req, res) => {
    return res.json(success({
      stats: storageManager.getAllQuotaStats(),
    }));
  }));

  return router;
}

export { createSystemStoragesRouter };
