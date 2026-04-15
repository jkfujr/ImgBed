import express from 'express';

import asyncHandler from '../../middleware/asyncHandler.js';
import { success } from '../../utils/response.js';

function createFilesMutateRouter({
  adminAuth,
  db,
  storageManager,
  applyPendingQuotaEvents,
  filesQueryService,
  fileUpdateService,
  deleteFileRecord,
  invalidateFilesCache,
} = {}) {
  const router = express.Router();

  router.put('/:id', adminAuth, asyncHandler(async (req, res) => {
    const result = fileUpdateService.updateFile(req.params.id, req.body || {});
    invalidateFilesCache();
    return res.json(success(result, '文件信息更新已完成'));
  }));

  router.delete('/:id', adminAuth, asyncHandler(async (req, res) => {
    const deleteMode = req.query.delete_mode || req.body?.delete_mode || 'remote_and_index';
    const fileRecord = filesQueryService.getFileDetail(req.params.id);

    await deleteFileRecord(fileRecord, {
      db,
      storageManager,
      applyPendingQuotaEvents,
      deleteMode,
    });
    invalidateFilesCache();

    return res.json(success({ id: req.params.id }, '文件删除成功'));
  }));

  return router;
}

export {
  createFilesMutateRouter,
};
