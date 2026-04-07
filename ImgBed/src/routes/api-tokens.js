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
import asyncHandler from '../middleware/asyncHandler.js';
import { NotFoundError } from '../errors/AppError.js';
import { success } from '../utils/response.js';

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

apiTokensApp.get('/', asyncHandler(async (_req, res) => {
  const list = sqlite.prepare(
    'SELECT * FROM api_tokens ORDER BY created_at DESC'
  ).all();

  return res.json(success(list.map(toSafeToken)));
}));

apiTokensApp.post('/', asyncHandler(async (req, res) => {
  const body = req.body || ;
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

  return res.json(success({
    ...toSafeToken(created),
    plainToken
  }, 'API Token 创建成功'));
}));

apiTokensApp.delete('/:id', asyncHandler(async (req, res) => {
  const id = req.params.id;
  const token = sqlite.prepare('SELECT id FROM api_tokens WHERE id = ? LIMIT 1').get(id);

  if (!token) {
    throw new NotFoundError('API Token 不存在');
  }

  sqlite.prepare('DELETE FROM api_tokens WHERE id = ?').run(id);
  return res.json(success({ id }, 'API Token 已删除'));
}));

export default apiTokensApp;
