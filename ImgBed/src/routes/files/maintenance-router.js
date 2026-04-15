import express from 'express';

import asyncHandler from '../../middleware/asyncHandler.js';
import { success } from '../../utils/response.js';

function createFilesMaintenanceRouter({
  requirePermission,
  filesMaintenanceService,
} = {}) {
  const router = express.Router();

  router.post('/maintenance/rebuild-metadata', requirePermission('admin'), asyncHandler(async (req, res) => {
    const result = filesMaintenanceService.startMetadataRebuild({
      force: req.query.force,
    });

    return res.json(success(result, '元数据重建任务已在后台启动'));
  }));

  return router;
}

export {
  createFilesMaintenanceRouter,
};
