const { Hono } = require('hono');
const config = require('../config');
const { signToken } = require('../utils/jwt');
const { adminAuth } = require('../middleware/auth');

const authApp = new Hono();

/**
 * 登录接口
 * POST /api/auth/login
 */
authApp.post('/login', async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const { username, password } = body;

  const adminConfig = config.admin || {};

  if (!username || !password) {
    return c.json({
      code: 400,
      message: '用户名或密码不可为空',
      error: {}
    }, 400);
  }

  // 对比系统配置中的 admin 账号 (支持单用户模式)
  if (username === adminConfig.username && password === adminConfig.password) {
    // 生成包含角色为 admin 的 JWT 载荷
    const payload = {
      role: 'admin',
      username: username,
      loginAt: Date.now()
    };
    const token = await signToken(payload);

    return c.json({
      code: 0,
      message: '登录成功',
      data: {
        token: token,
        username: username,
        role: 'admin' // 告知前端当前是以管理身份运行
      }
    });
  } else {
    return c.json({
      code: 401,
      message: '用户名或密码不正确',
      error: {}
    }, 401); // 这里标准一点返回 401 状态码更符合规范
  }
});

/**
 * 获取当前登录用户信息接口
 * GET /api/auth/me
 */
authApp.get('/me', adminAuth, async (c) => {
  // 经 adminAuth 拦截中间件后，从上下文中读取用户数据载荷
  const user = c.get('user');
  
  return c.json({
    code: 0,
    message: '获取成功',
    data: {
      username: user.username,
      role: user.role
    }
  });
});

/**
 * 登出接口
 * POST /api/auth/logout
 * 注: JWT本身是无状态的，实际效果由前端自行清除 localstorage token 控制
 */
authApp.post('/logout', adminAuth, async (c) => {
  return c.json({
    code: 0,
    message: '登出成功',
    data: {}
  });
});

module.exports = authApp;
