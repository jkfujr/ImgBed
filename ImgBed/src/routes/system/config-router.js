import express from 'express';

import asyncHandler from '../../middleware/asyncHandler.js';
import { success } from '../../utils/response.js';

function createSystemConfigRouter({
  systemConfigCache,
  readRuntimeConfig,
  sanitizeSystemConfig,
  systemConfigService,
} = {}) {
  const router = express.Router();

  router.get('/config', systemConfigCache(), asyncHandler(async (_req, res) => {
    return res.json(success(sanitizeSystemConfig(readRuntimeConfig())));
  }));

  router.put('/config', asyncHandler(async (req, res) => {
    systemConfigService.updateConfig(req.body || {});
    return res.json(success(null, '配置已保存，部分配置需重启服务后生效'));
  }));

  return router;
}

export { createSystemConfigRouter };
