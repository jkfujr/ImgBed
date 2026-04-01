const crypto = require('crypto');
const { db } = require('../database');

const API_TOKEN_PERMISSIONS = {
  UPLOAD_IMAGE: 'upload:image',
  FILES_READ: 'files:read'
};

const ALLOWED_API_TOKEN_PERMISSIONS = new Set(Object.values(API_TOKEN_PERMISSIONS));

const generateTokenId = () => {
  return `tok_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
};

const generatePlainApiToken = () => {
  const prefix = `ib_${crypto.randomBytes(4).toString('hex')}`;
  const secret = crypto.randomBytes(24).toString('hex');
  return {
    plainToken: `${prefix}.${secret}`,
    tokenPrefix: prefix
  };
};

const hashApiToken = (plainToken) => {
  return crypto.createHash('sha256').update(plainToken).digest('hex');
};

const normalizePermissions = (permissions = []) => {
  if (!Array.isArray(permissions)) return [];
  return Array.from(new Set(
    permissions
      .map((permission) => String(permission || '').trim())
      .filter((permission) => ALLOWED_API_TOKEN_PERMISSIONS.has(permission))
  ));
};

const parsePermissions = (rawPermissions) => {
  try {
    const parsed = JSON.parse(rawPermissions || '[]');
    return normalizePermissions(parsed);
  } catch (_) {
    return [];
  }
};

const isExpired = (expiresAt) => {
  if (!expiresAt) return false;
  return new Date(expiresAt).getTime() <= Date.now();
};

const buildApiTokenAuth = (tokenRow) => {
  const permissions = parsePermissions(tokenRow.permissions);
  return {
    type: 'api_token',
    role: 'api_token',
    tokenId: tokenRow.id,
    tokenName: tokenRow.name,
    permissions,
    expiresAt: tokenRow.expires_at || null,
    createdBy: tokenRow.created_by || 'admin'
  };
};

const verifyApiToken = async (plainToken, requestIp) => {
  const tokenHash = hashApiToken(plainToken);
  const tokenRow = await db.selectFrom('api_tokens')
    .selectAll()
    .where('token_hash', '=', tokenHash)
    .executeTakeFirst();

  if (!tokenRow) return null;
  if (tokenRow.status !== 'active') return null;
  if (isExpired(tokenRow.expires_at)) return null;

  await db.updateTable('api_tokens')
    .set({
      last_used_at: new Date().toISOString(),
      last_used_ip: requestIp || 'unknown'
    })
    .where('id', '=', tokenRow.id)
    .execute();

  return buildApiTokenAuth(tokenRow);
};

module.exports = {
  API_TOKEN_PERMISSIONS,
  ALLOWED_API_TOKEN_PERMISSIONS,
  generateTokenId,
  generatePlainApiToken,
  hashApiToken,
  normalizePermissions,
  parsePermissions,
  isExpired,
  buildApiTokenAuth,
  verifyApiToken
};
