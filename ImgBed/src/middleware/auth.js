import { verifyToken } from '../utils/jwt.js';
import { verifyApiToken } from '../utils/apiToken.js';

const extractBearerToken = (req) => {
  const authHeader = req.get('Authorization');
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return null;
  }
  return authHeader.split(' ')[1];
};

const unauthorized = (message = '未授权：缺失有效的 Bearer Token') => {
  return {
    code: 401,
    message
  };
};

const forbidden = (message = '权限不足') => {
  return {
    code: 403,
    message
  };
};

const getRequestIp = (req) => {
  return req.get('x-forwarded-for') || req.get('cf-connecting-ip') || req.ip || 'unknown';
};

const resolveAuth = async (req) => {
  const rawToken = extractBearerToken(req);
  if (!rawToken) {
    return null;
  }

  const jwtPayload = await verifyToken(rawToken);
  if (jwtPayload && jwtPayload.role === 'admin') {
    const auth = {
      type: 'admin_jwt',
      role: 'admin',
      username: jwtPayload.username,
      permissions: ['*']
    };
    req.auth = auth;
    req.user = jwtPayload;
    return auth;
  }

  const apiTokenAuth = await verifyApiToken(rawToken, getRequestIp(req));
  if (apiTokenAuth) {
    req.auth = apiTokenAuth;
    return apiTokenAuth;
  }

  return null;
};

/**
 * 拦截请求，解析并鉴权管理员 Token 中间件
 */
const adminAuth = async (req, res, next) => {
  const auth = await resolveAuth(req);

  if (!auth) {
    return res.status(401).json(unauthorized());
  }

  if (auth.role !== 'admin') {
    return res.status(401).json(unauthorized('鉴权失败：需要管理员身份'));
  }

  return next();
};

const requireAuth = async (req, res, next) => {
  const auth = await resolveAuth(req);
  if (!auth) {
    return res.status(401).json(unauthorized());
  }
  return next();
};

const requirePermission = (permission) => {
  return async (req, res, next) => {
    const auth = await resolveAuth(req);
    if (!auth) {
      return res.status(401).json(unauthorized());
    }

    const permissions = auth.permissions || [];
    if (auth.role === 'admin' || permissions.includes('*') || permissions.includes(permission)) {
      return next();
    }

    return res.status(403).json(forbidden(`缺少权限：${permission}`));
  };
};

export { adminAuth,
  extractBearerToken,
  resolveAuth,
  requireAuth,
  requirePermission };
