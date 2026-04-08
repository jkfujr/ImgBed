import express from 'express';
import { readSystemConfig } from '../services/system/config-io.js';
import { fileURLToPath } from 'url';
import path from 'path';
import { success } from '../utils/response.js';

const publicApp = express.Router();
const configPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../config.json');

/**
 * 获取访客上传配置（公开接口，无需认证）
 * GET /api/public/guest-upload-config
 */
publicApp.get('/guest-upload-config', (req, res) => {
  const cfg = readSystemConfig(configPath);
  const guestUploadEnabled = cfg.security?.guestUploadEnabled || false;
  const requirePassword = guestUploadEnabled && !!cfg.security?.uploadPassword;

  return res.json(success({
    guestUploadEnabled,
    requirePassword
  }));
});

export default publicApp;
