import { Hono } from 'hono';
import config from '../config/index.js';
import { signToken } from '../utils/jwt.js';
import { adminAuth } from '../middleware/auth.js';
import { sqlite } from '../database/index.js';
import { verifyAdminCredentials } from '../services/auth/verify-credentials.js';

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

  const isValid = await verifyAdminCredentials(username, password, adminConfig, sqlite);

  if (isValid) {
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
    const existing = sqlite.prepare('SELECT key FROM system_settings WHERE key = ? LIMIT 1').get('admin_password');

    if (existing) {
      sqlite.prepare('UPDATE system_settings SET value = ? WHERE key = ?').run(newPassword, 'admin_password');
    } else {
      sqlite.prepare(
        'INSERT INTO system_settings (key, value, category, description) VALUES (?, ?, ?, ?)'
      ).run('admin_password', newPassword, 'auth', '管理员密码（覆盖 config.json）');
    }

    return c.json({ code: 0, message: '密码修改成功', data: {} });
  } catch (err) {
    console.error('[Auth API] 修改密码失败:', err);
    return c.json({ code: 500, message: '密码修改失败：' + err.message, error: err.message }, 500);
  }
});

export default authApp;
