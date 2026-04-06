import express from 'express';
import config from '../config/index.js';
import { signToken } from '../utils/jwt.js';
import { adminAuth } from '../middleware/auth.js';
import { sqlite } from '../database/index.js';
import { verifyAdminCredentials } from '../services/auth/verify-credentials.js';
import asyncHandler from '../middleware/asyncHandler.js';
import { ValidationError, AuthError } from '../errors/AppError.js';

const authApp = express.Router();

/**
 * 登录接口
 * POST /api/auth/login
 */
authApp.post('/login', asyncHandler(async (req, res) => {
  const body = req.body || {};
  const { username, password } = body;

  const adminConfig = config.admin || {};

  if (!username || !password) {
    throw new ValidationError('用户名或密码不可为空');
  }

  const isValid = await verifyAdminCredentials(username, password, adminConfig, sqlite);

  if (!isValid) {
    throw new AuthError('用户名或密码不正确');
  }

  const payload = {
    role: 'admin',
    username: username,
    loginAt: Date.now()
  };
  const token = await signToken(payload);

  return res.json({
    code: 0,
    message: '登录成功',
    data: {
      token: token,
      username: username,
      role: 'admin'
    }
  });
}));

/**
 * 获取当前登录用户信息接口
 * GET /api/auth/me
 */
authApp.get('/me', adminAuth, asyncHandler(async (req, res) => {
  const user = req.user;

  return res.json({
    code: 0,
    message: '获取成功',
    data: {
      username: user.username,
      role: user.role
    }
  });
}));

/**
 * 登出接口
 * POST /api/auth/logout
 */
authApp.post('/logout', adminAuth, asyncHandler(async (_req, res) => {
  return res.json({
    code: 0,
    message: '登出成功',
    data: {}
  });
}));

/**
 * 修改管理员密码
 * PUT /api/auth/password
 */
authApp.put('/password', adminAuth, asyncHandler(async (req, res) => {
  const body = req.body || {};
  const { newPassword } = body;

  if (!newPassword || newPassword.length < 6) {
    throw new ValidationError('新密码不能为空且长度不能少于6位');
  }

  const existing = sqlite.prepare('SELECT key FROM system_settings WHERE key = ? LIMIT 1').get('admin_password');

  if (existing) {
    sqlite.prepare('UPDATE system_settings SET value = ? WHERE key = ?').run(newPassword, 'admin_password');
  } else {
    sqlite.prepare(
      'INSERT INTO system_settings (key, value, category, description) VALUES (?, ?, ?, ?)'
    ).run('admin_password', newPassword, 'auth', '管理员密码（覆盖 config.json）');
  }

  return res.json({ code: 0, message: '密码修改成功', data: {} });
}));

export default authApp;
