import express from 'express';

import asyncHandler from '../../middleware/asyncHandler.js';
import { success } from '../../utils/response.js';

function createFilesReadRouter({
  requirePermission,
  filesListCache,
  filesQueryService,
} = {}) {
  const router = express.Router();

  router.get('/', requirePermission('files:read'), filesListCache(), asyncHandler(async (req, res) => {
    return res.json(success(filesQueryService.listFiles({
      page: req.query.page,
      pageSize: req.query.pageSize,
      directory: req.query.directory,
      search: req.query.search,
    })));
  }));

  router.get('/:id', requirePermission('files:read'), asyncHandler(async (req, res) => {
    return res.json(success(filesQueryService.getFileDetail(req.params.id)));
  }));

  return router;
}

export {
  createFilesReadRouter,
};
