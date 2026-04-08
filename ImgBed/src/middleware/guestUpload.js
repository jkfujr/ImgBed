import { readSystemConfig } from '../services/system/config-io.js';
import { ErrorResponse, send401WithBodyConsumption } from '../utils/response.js';
import path from 'path';
import { fileURLToPath } from 'url';

const configPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../config.json');

/**
 * 访客上传中间件
 * 检查是否允许访客上传，以及是否需要密码验证
 */
export const guestUploadAuth = async (req, res, next) => {
  const cfg = readSystemConfig(configPath);
  const guestUploadEnabled = cfg.security?.guestUploadEnabled || false;
  const uploadPassword = cfg.security?.uploadPassword || '';

  // 检查是否有有效的 Bearer Token
  const authHeader = req.get('Authorization');
  const hasToken = authHeader && authHeader.startsWith('Bearer ');

  // 如果有 Token，直接继续走原有的认证流程
  if (hasToken) {
    return next();
  }

  // 没有 Token，检查是否允许访客上传
  if (!guestUploadEnabled) {
    send401WithBodyConsumption(req, res, ErrorResponse.UNAUTHORIZED_GUEST_DISABLED);
    return;
  }

  // 开启了访客上传，检查是否设置了上传密码
  if (uploadPassword) {
    // 只从请求头获取密码（multipart/form-data 的 body 需要 multer 解析，此时还未解析）
    const providedPassword = req.get('X-Upload-Password');

    if (!providedPassword) {
      send401WithBodyConsumption(req, res, ErrorResponse.UNAUTHORIZED_PASSWORD_REQUIRED);
      return;
    }

    if (providedPassword !== uploadPassword) {
      send401WithBodyConsumption(req, res, ErrorResponse.UNAUTHORIZED_PASSWORD_WRONG);
      return;
    }
  }

  // 访客上传已开启，且密码验证通过（或无需密码）
  // 设置一个访客身份标识
  req.auth = {
    type: 'guest',
    role: 'guest',
    username: 'guest',
    permissions: ['upload:image']
  };

  return next();
};
