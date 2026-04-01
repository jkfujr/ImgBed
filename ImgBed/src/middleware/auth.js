const { verifyToken } = require('../utils/jwt');
const { verifyApiToken } = require('../utils/apiToken');

const extractBearerToken = (c) => {
  const authHeader = c.req.header('Authorization');
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return null;
  }
  return authHeader.split(' ')[1];
};

const unauthorized = (message = '未授权：缺失有效的 Bearer Token') => {
  return {
    code: 401,
    message,
    error: {}
  };
};

const forbidden = (message = '权限不足') => {
  return {
    code: 403,
    message,
    error: {}
  };
};

const getRequestIp = (c) => {
  return c.req.header('x-forwarded-for') || c.req.header('cf-connecting-ip') || 'unknown';
};

const resolveAuth = async (c) => {
  const rawToken = extractBearerToken(c);
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
    c.set('auth', auth);
    c.set('user', jwtPayload);
    return auth;
  }

  const apiTokenAuth = await verifyApiToken(rawToken, getRequestIp(c));
  if (apiTokenAuth) {
    c.set('auth', apiTokenAuth);
    return apiTokenAuth;
  }

  return null;
};

/**
 * 拦截请求，解析并鉴权管理员 Token 中间件
 */
const adminAuth = async (c, next) => {
  const auth = await resolveAuth(c);

  if (!auth) {
    return c.json(unauthorized(), 401);
  }

  if (auth.role !== 'admin') {
    return c.json(unauthorized('鉴权失败：需要管理员身份'), 401);
  }

  await next();
};

const requireAuth = async (c, next) => {
  const auth = await resolveAuth(c);
  if (!auth) {
    return c.json(unauthorized(), 401);
  }
  await next();
};

const requirePermission = (permission) => {
  return async (c, next) => {
    const auth = await resolveAuth(c);
    if (!auth) {
      return c.json(unauthorized(), 401);
    }

    const permissions = auth.permissions || [];
    if (auth.role === 'admin' || permissions.includes('*') || permissions.includes(permission)) {
      await next();
      return;
    }

    return c.json(forbidden(`缺少权限：${permission}`), 403);
  };
};

module.exports = {
  adminAuth,
  extractBearerToken,
  resolveAuth,
  requireAuth,
  requirePermission
};
