import express from 'express';
import { API_TOKEN_PERMISSIONS,
  generateTokenId,
  generatePlainApiToken,
  hashApiToken,
  normalizePermissions,
  parsePermissions,
  isExpired } from '../utils/apiToken.js';
import { adminAuth } from '../middleware/auth.js';
import { sqlite } from '../database/index.js';
import { validateTokenInput, createTokenRecord } from '../services/api-tokens/create-token.js';

const apiTokensApp = express.Router();

apiTokensApp.use(adminAuth);

const toSafeToken = (tokenRow) => ({
  id: tokenRow.id,
  name: tokenRow.name,
  token_prefix: tokenRow.token_prefix,
  permissions: parsePermissions(tokenRow.permissions),
  status: tokenRow.status,
  expires_at: tokenRow.expires_at,
  last_used_at: tokenRow.last_used_at,
  last_used_ip: tokenRow.last_used_ip,
  created_by: tokenRow.created_by,
  created_at: tokenRow.created_at,
  updated_at: tokenRow.updated_at,
  is_expired: isExpired(tokenRow.expires_at)
});

apiTokensApp.get('/', async (_req, res) => {
  try {
    const list = sqlite.prepare(
      'SELECT * FROM api_tokens ORDER BY created_at DESC'
    ).all();

    return res.json({
      code: 0,
      message: 'success',
      data: list.map(toSafeToken)
    });
  } catch (err) {
    console.error('[API Token] 获取列表失败:', err);
    return res.status(500).json({ code: 500, message: '获取 API Token 列表失败', error: err.message });
  }
});

apiTokensApp.post('/', async (req, res) => {
  try {
    const body = req.body || {};
    const validated = validateTokenInput(body);

    const { plainToken, tokenPrefix } = generatePlainApiToken();
    const tokenRow = createTokenRecord(
      validated,
      plainToken,
      tokenPrefix,
      hashApiToken(plainToken),
      generateTokenId
    );

    sqlite.prepare(
      `INSERT INTO api_tokens (
        id, name, token_prefix, token_hash, permissions, status,
        expires_at, last_used_at, last_used_ip, created_by, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      tokenRow.id,
      tokenRow.name,
      tokenRow.token_prefix,
      tokenRow.token_hash,
      tokenRow.permissions,
      tokenRow.status,
      tokenRow.expires_at,
      tokenRow.last_used_at,
      tokenRow.last_used_ip,
      tokenRow.created_by,
      tokenRow.created_at,
      tokenRow.updated_at
    );

    const created = sqlite.prepare(
      'SELECT * FROM api_tokens WHERE id = ? LIMIT 1'
    ).get(tokenRow.id);

    return res.json({
      code: 0,
      message: 'API Token 创建成功',
      data: {
        ...toSafeToken(created),
        plainToken
      }
    });
  } catch (err) {
    if (err.status) {
      return res.status(err.status).json({ code: err.status, message: err.message, error: {} });
    }
    console.error('[API Token] 创建失败:', err);
    return res.status(500).json({ code: 500, message: '创建 API Token 失败', error: err.message });
  }
});

apiTokensApp.delete('/:id', async (req, res) => {
  try {
    const id = req.params.id;
    const token = sqlite.prepare('SELECT id FROM api_tokens WHERE id = ? LIMIT 1').get(id);

    if (!token) {
      return res.status(404).json({ code: 404, message: 'API Token 不存在', error: {} });
    }

    sqlite.prepare('DELETE FROM api_tokens WHERE id = ?').run(id);
    return res.json({ code: 0, message: 'API Token 已删除', data: { id } });
  } catch (err) {
    console.error('[API Token] 删除失败:', err);
    return res.status(500).json({ code: 500, message: '删除 API Token 失败', error: err.message });
  }
});

export default apiTokensApp;
