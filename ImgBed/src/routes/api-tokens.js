const { Hono } = require('hono');
const {
  API_TOKEN_PERMISSIONS,
  generateTokenId,
  generatePlainApiToken,
  hashApiToken,
  normalizePermissions,
  parsePermissions,
  isExpired
} = require('../utils/apiToken');
const { adminAuth } = require('../middleware/auth');
const { db } = require('../database');

const apiTokensApp = new Hono();

apiTokensApp.use('*', adminAuth);

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

apiTokensApp.get('/', async (c) => {
  try {
    const list = await db.selectFrom('api_tokens')
      .selectAll()
      .orderBy('created_at', 'desc')
      .execute();

    return c.json({
      code: 0,
      message: 'success',
      data: list.map(toSafeToken)
    });
  } catch (err) {
    console.error('[API Token] 获取列表失败:', err);
    return c.json({ code: 500, message: '获取 API Token 列表失败', error: err.message }, 500);
  }
});

apiTokensApp.post('/', async (c) => {
  try {
    const body = await c.req.json().catch(() => ({}));
    const name = String(body.name || '').trim();
    const permissions = normalizePermissions(body.permissions || []);
    const expiresMode = body.expiresMode === 'custom' ? 'custom' : 'never';
    const expiresAt = body.expiresAt ? new Date(body.expiresAt) : null;

    if (!name) {
      return c.json({ code: 400, message: 'Token 名称不能为空', error: {} }, 400);
    }

    if (permissions.length === 0) {
      return c.json({ code: 400, message: '至少选择一项权限', error: {} }, 400);
    }

    if (!permissions.includes(API_TOKEN_PERMISSIONS.UPLOAD_IMAGE) && !permissions.includes(API_TOKEN_PERMISSIONS.FILES_READ)) {
      return c.json({ code: 400, message: '权限配置无效', error: {} }, 400);
    }

    let normalizedExpiresAt = null;
    if (expiresMode === 'custom') {
      if (!expiresAt || Number.isNaN(expiresAt.getTime())) {
        return c.json({ code: 400, message: '过期时间格式无效', error: {} }, 400);
      }
      if (expiresAt.getTime() <= Date.now()) {
        return c.json({ code: 400, message: '过期时间必须晚于当前时间', error: {} }, 400);
      }
      normalizedExpiresAt = expiresAt.toISOString();
    }

    const { plainToken, tokenPrefix } = generatePlainApiToken();
    const tokenRow = {
      id: generateTokenId(),
      name,
      token_prefix: tokenPrefix,
      token_hash: hashApiToken(plainToken),
      permissions: JSON.stringify(permissions),
      status: 'active',
      expires_at: normalizedExpiresAt,
      created_by: 'admin'
    };

    await db.insertInto('api_tokens').values(tokenRow).execute();

    const created = await db.selectFrom('api_tokens')
      .selectAll()
      .where('id', '=', tokenRow.id)
      .executeTakeFirst();

    return c.json({
      code: 0,
      message: 'API Token 创建成功',
      data: {
        ...toSafeToken(created),
        plainToken
      }
    });
  } catch (err) {
    console.error('[API Token] 创建失败:', err);
    return c.json({ code: 500, message: '创建 API Token 失败', error: err.message }, 500);
  }
});

apiTokensApp.delete('/:id', async (c) => {
  try {
    const id = c.req.param('id');
    const token = await db.selectFrom('api_tokens')
      .select(['id'])
      .where('id', '=', id)
      .executeTakeFirst();

    if (!token) {
      return c.json({ code: 404, message: 'API Token 不存在', error: {} }, 404);
    }

    await db.deleteFrom('api_tokens').where('id', '=', id).execute();
    return c.json({ code: 0, message: 'API Token 已删除', data: { id } });
  } catch (err) {
    console.error('[API Token] 删除失败:', err);
    return c.json({ code: 500, message: '删除 API Token 失败', error: err.message }, 500);
  }
});

module.exports = apiTokensApp;
