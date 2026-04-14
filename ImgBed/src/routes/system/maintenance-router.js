import express from 'express';

import asyncHandler from '../../middleware/asyncHandler.js';
import { success } from '../../utils/response.js';

function createSystemMaintenanceRouter({
  maintenanceService,
} = {}) {
  const router = express.Router();

  router.post('/maintenance/rebuild-quota-stats', asyncHandler(async (_req, res) => {
    const result = maintenanceService.triggerQuotaStatsRebuild();
    return res.json(success(result, '容量校正任务已在后台启动'));
  }));

  router.get('/maintenance/quota-history', asyncHandler(async (req, res) => {
    return res.json(success(maintenanceService.getQuotaHistory({
      limit: req.query.limit,
      storageId: req.query.storage_id,
    })));
  }));

  return router;
}

export { createSystemMaintenanceRouter };
