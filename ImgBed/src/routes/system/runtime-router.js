import express from 'express';

import asyncHandler from '../../middleware/asyncHandler.js';
import { success } from '../../utils/response.js';

function createSystemRuntimeRouter({
  getResponseCache,
  getQuotaEventsArchive,
  getArchiveScheduler,
  cacheInvalidation,
} = {}) {
  const router = express.Router();

  router.get('/cache/stats', asyncHandler(async (_req, res) => {
    return res.json(success(getResponseCache().getStats()));
  }));

  router.post('/cache/clear', asyncHandler(async (_req, res) => {
    cacheInvalidation.invalidateAll();
    return res.json(success(null, '缓存已清空'));
  }));

  router.get('/archive/stats', asyncHandler(async (_req, res) => {
    return res.json(success(getQuotaEventsArchive().getStats()));
  }));

  router.post('/archive/run', asyncHandler(async (_req, res) => {
    const result = await getArchiveScheduler().runNow();
    if (result.skipped) {
      return res.json(success(result, '归档任务正在执行中，已跳过本次触发'));
    }

    return res.json(success(result, '归档任务执行完成'));
  }));

  router.get('/archive/scheduler', asyncHandler(async (_req, res) => {
    return res.json(success(getArchiveScheduler().getStatus()));
  }));

  return router;
}

export { createSystemRuntimeRouter };
