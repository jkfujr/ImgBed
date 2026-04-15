import express from 'express';

import asyncHandler from '../../middleware/asyncHandler.js';

function createFilesBatchRouter({
  adminAuth,
  db,
  storageManager,
  executeFilesBatchAction,
  invalidateFilesCache,
} = {}) {
  const router = express.Router();

  router.post('/batch', adminAuth, asyncHandler(async (req, res) => {
    const body = req.body || {};
    const response = await executeFilesBatchAction({
      action: body.action,
      ids: body.ids,
      targetDirectory: body.target_directory,
      targetChannel: body.target_channel,
      deleteMode: body.delete_mode || 'remote_and_index',
      db,
      storageManager,
    });

    invalidateFilesCache();
    return res.json(response);
  }));

  return router;
}

export {
  createFilesBatchRouter,
};
