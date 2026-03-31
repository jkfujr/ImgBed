const { Hono } = require('hono');
const config = require('../config');
const { signToken } = require('../utils/jwt');
const { adminAuth } = require('../middleware/auth');
const { db } = require('../database');

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

  // 优先从 system_settings 读取覆盖密码（通过 PUT /api/auth/password 修改后存入）
  let effectivePassword = adminConfig.password;
  try {
    const row = await db.selectFrom('system_settings')
      .select('value')
      .where('key', '=', 'admin_password')
      .executeTakeFirst();
    if (row) effectivePassword = row.value;
  } catch (_) { /* 数据库未就绪时降级为 config 密码 */ }

  // 对比系统配置中的 admin 账号 (支持单用户模式)
  if (username === adminConfig.username && password === effectivePassword) {
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

/**
 * 修改管理员密码
 * PUT /api/auth/password
 */
authApp.put('/password', adminAuth, async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const { newPassword } = body;

  if (!newPassword || newPassword.length < 6) {
    return c.json({ code: 400, message: '新密码不能为空且长度不能少于6位', error: {} }, 400);
  }

  try {
    // 写入或更新 system_settings 中的 admin_password
    const existing = await db.selectFrom('system_settings')
      .select('key')
      .where('key', '=', 'admin_password')
      .executeTakeFirst();

    if (existing) {
      await db.updateTable('system_settings')
        .set({ value: newPassword })
        .where('key', '=', 'admin_password')
        .execute();
    } else {
      await db.insertInto('system_settings')
        .values({ key: 'admin_password', value: newPassword, category: 'auth', description: '管理员密码（覆盖 config.json）' })
        .execute();
    }

    return c.json({ code: 0, message: '密码修改成功', data: {} });
  } catch (err) {
    console.error('[Auth API] 修改密码失败:', err);
    return c.json({ code: 500, message: '密码修改失败：' + err.message, error: err.message }, 500);
  }
});

module.exports = authApp;
