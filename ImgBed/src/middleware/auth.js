const { verifyToken } = require('../utils/jwt');

/**
 * 拦截请求，解析并鉴权管理员 Token 中间件
 */
const adminAuth = async (c, next) => {
  const authHeader = c.req.header('Authorization');
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return c.json({
      code: 401,
      message: '未授权：缺失有效的 Bearer Token',
      error: {}
    }, 401);
  }

  const token = authHeader.split(' ')[1];
  const payload = await verifyToken(token);

  if (!payload || payload.role !== 'admin') {
    return c.json({
      code: 401,
      message: '鉴权失败：Token 无效或已过期',
      error: {}
    }, 401);
  }

  // 将验证解析后的载荷挂载到上下文 c 中，供后续路由使用
  c.set('user', payload);
  await next();
};

module.exports = {
  adminAuth
};
