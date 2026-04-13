import express from 'express';
import { readSystemConfig } from '../services/system/config-io.js';
import { success } from '../utils/response.js';

const publicApp = express.Router();

/**
 * 获取访客上传配置（公开接口，无需认证）
 * GET /api/public/guest-upload-config
 */
publicApp.get('/guest-upload-config', (req, res) => {
  const cfg = readSystemConfig();
  const guestUploadEnabled = cfg.security?.guestUploadEnabled || false;
  const requirePassword = guestUploadEnabled && !!cfg.security?.uploadPassword;

  return res.json(success({
    guestUploadEnabled,
    requirePassword
  }));
});

export default publicApp;
