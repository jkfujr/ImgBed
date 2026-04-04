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
const { validateTokenInput, createTokenRecord } = require('../services/api-tokens/create-token');

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
    const validated = validateTokenInput(body);

    const { plainToken, tokenPrefix } = generatePlainApiToken();
    const tokenRow = createTokenRecord(
      validated,
      plainToken,
      tokenPrefix,
      hashApiToken(plainToken),
      generateTokenId
    );

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
    if (err.status) {
      return c.json({ code: err.status, message: err.message, error: {} }, err.status);
    }
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
