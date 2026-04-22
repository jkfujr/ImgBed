import express from 'express';
import multer from 'multer';

import { requirePermission } from '../middleware/auth.js';
import asyncHandler from '../middleware/asyncHandler.js';
import { guestUploadAuth } from '../middleware/guestUpload.js';
import { createUploadApplicationService } from '../services/upload/upload-application-service.js';
import { success } from '../utils/response.js';

const defaultUploadMiddleware = multer({
  storage: multer.memoryStorage(),
  defParamCharset: 'utf8',
}).single('file');

function createUploadRouter({
  guestUploadAuth: guestUploadAuthMiddleware = guestUploadAuth,
  requirePermission: requirePermissionFactory = requirePermission,
  uploadMiddleware = defaultUploadMiddleware,
  uploadApplicationService = null,
  success: successBuilder = success,
  ...serviceOverrides
} = {}) {
  const router = express.Router();
  const applicationService = uploadApplicationService || createUploadApplicationService(serviceOverrides);

  router.post(
    '/',
    guestUploadAuthMiddleware,
    requirePermissionFactory('upload:image'),
    uploadMiddleware,
    asyncHandler(async (req, res) => {
      const result = await applicationService.handleUpload({
        body: req.body || {},
        file: req.file || null,
        auth: req.auth || null,
        clientIp: req.get('x-forwarded-for') || req.get('cf-connecting-ip') || req.ip || 'unknown',
      });

      return res.json(successBuilder(result.data, result.message));
    }),
  );

  return router;
}

const uploadApp = createUploadRouter();

export {
  createUploadRouter,
};

export default uploadApp;
