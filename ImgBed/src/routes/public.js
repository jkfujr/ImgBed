import express from 'express';
import { readRuntimeConfig } from '../config/index.js';
import { success } from '../utils/response.js';

const publicApp = express.Router();

/**
 * 获取访客上传配置（公开接口，无需认证）
 * GET /api/public/guest-upload-config
 */
publicApp.get('/guest-upload-config', (req, res) => {
  const cfg = readRuntimeConfig();
  const guestUploadEnabled = cfg.security?.guestUploadEnabled || false;
  const requirePassword = guestUploadEnabled && !!cfg.security?.uploadPassword;

  return res.json(success({
    guestUploadEnabled,
    requirePassword
  }));
});

export default publicApp;
