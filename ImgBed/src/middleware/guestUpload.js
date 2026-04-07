import { readSystemConfig } from '../services/system/config-io.js';
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
    return res.status(401).json({
      code: 401,
      message: '未授权：请登录后上传，或联系管理员开启访客上传功能'
    });
  }

  // 开启了访客上传，检查是否设置了上传密码
  if (uploadPassword) {
    // 从请求头或请求体中获取密码
    const providedPassword = req.get('X-Upload-Password') || req.body?.uploadPassword;

    if (!providedPassword) {
      return res.status(401).json({
        code: 401,
        message: '未授权：需要上传密码'
      });
    }

    if (providedPassword !== uploadPassword) {
      return res.status(401).json({
        code: 401,
        message: '未授权：上传密码错误'
      });
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
