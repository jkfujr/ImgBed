import crypto from 'crypto';
import { sqlite } from '../database/index.js';

const API_TOKEN_HASH_ALGORITHM = 'scrypt';
const API_TOKEN_HASH_VERSION = '1';
const API_TOKEN_SALT_LENGTH = 16;
const API_TOKEN_KEY_LENGTH = 64;
const API_TOKEN_SCRYPT_OPTIONS = {
  N: 16384,
  r: 8,
  p: 1,
  maxmem: 32 * 1024 * 1024,
};

const API_TOKEN_PERMISSIONS = {
  UPLOAD_IMAGE: 'upload:image',
  FILES_READ: 'files:read',
  DIRECTORIES_READ: 'directories:read'
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

function safeCompareBuffer(left, right) {
  if (!Buffer.isBuffer(left) || !Buffer.isBuffer(right) || left.length !== right.length) {
    return false;
  }

  return crypto.timingSafeEqual(left, right);
}

function buildApiTokenHash(salt, derivedKey) {
  return [
    API_TOKEN_HASH_ALGORITHM,
    API_TOKEN_HASH_VERSION,
    salt.toString('base64'),
    derivedKey.toString('base64'),
  ].join('$');
}

function parseApiTokenHash(tokenHash) {
  if (typeof tokenHash !== 'string') {
    return null;
  }

  const parts = tokenHash.split('$');
  if (parts.length !== 4) {
    return null;
  }

  const [algorithm, version, saltBase64, keyBase64] = parts;
  if (algorithm !== API_TOKEN_HASH_ALGORITHM || version !== API_TOKEN_HASH_VERSION) {
    return null;
  }

  return {
    salt: Buffer.from(saltBase64, 'base64'),
    expectedKey: Buffer.from(keyBase64, 'base64'),
  };
}

function deriveApiTokenKey(plainToken, salt) {
  return crypto.scryptSync(
    plainToken,
    salt,
    API_TOKEN_KEY_LENGTH,
    API_TOKEN_SCRYPT_OPTIONS,
  );
}

const hashApiToken = (plainToken, { randomBytes = crypto.randomBytes } = {}) => {
  if (typeof plainToken !== 'string' || plainToken.length === 0) {
    throw new TypeError('API Token 必须是非空字符串');
  }

  const salt = randomBytes(API_TOKEN_SALT_LENGTH);
  const derivedKey = deriveApiTokenKey(plainToken, salt);
  return buildApiTokenHash(salt, derivedKey);
};

function verifyApiTokenHash(plainToken, tokenHash) {
  if (typeof plainToken !== 'string' || plainToken.length === 0) {
    return false;
  }

  const parsed = parseApiTokenHash(tokenHash);
  if (!parsed) {
    return false;
  }

  const actualKey = deriveApiTokenKey(plainToken, parsed.salt);
  return safeCompareBuffer(actualKey, parsed.expectedKey);
}

function parseTokenPrefix(plainToken) {
  if (typeof plainToken !== 'string') {
    return null;
  }

  const separatorIndex = plainToken.indexOf('.');
  if (separatorIndex <= 0) {
    return null;
  }

  return plainToken.slice(0, separatorIndex);
}

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
  const tokenPrefix = parseTokenPrefix(plainToken);
  if (!tokenPrefix) {
    return null;
  }

  const tokenRows = sqlite.prepare(
    'SELECT * FROM api_tokens WHERE token_prefix = ? AND status = ?'
  ).all(tokenPrefix, 'active');
  const tokenRow = tokenRows.find((row) => verifyApiTokenHash(plainToken, row.token_hash));

  if (!tokenRow) return null;
  if (isExpired(tokenRow.expires_at)) return null;

  sqlite.prepare(
    'UPDATE api_tokens SET last_used_at = ?, last_used_ip = ? WHERE id = ?'
  ).run(new Date().toISOString(), requestIp || 'unknown', tokenRow.id);

  return buildApiTokenAuth(tokenRow);
};

export { API_TOKEN_PERMISSIONS,
  ALLOWED_API_TOKEN_PERMISSIONS,
  generateTokenId,
  generatePlainApiToken,
  hashApiToken,
  verifyApiTokenHash,
  normalizePermissions,
  parsePermissions,
  isExpired,
  buildApiTokenAuth,
  verifyApiToken };
