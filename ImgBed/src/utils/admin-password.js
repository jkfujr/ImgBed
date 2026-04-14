import crypto from 'crypto';

const ADMIN_PASSWORD_HASH_ALGORITHM = 'scrypt';
const ADMIN_PASSWORD_HASH_VERSION = '1';
const ADMIN_PASSWORD_SALT_LENGTH = 16;
const ADMIN_PASSWORD_KEY_LENGTH = 64;
const ADMIN_PASSWORD_SCRYPT_OPTIONS = {
  N: 16384,
  r: 8,
  p: 1,
  maxmem: 32 * 1024 * 1024,
};

function safeCompareText(left, right) {
  if (typeof left !== 'string' || typeof right !== 'string') {
    return false;
  }

  const leftBuffer = Buffer.from(left, 'utf8');
  const rightBuffer = Buffer.from(right, 'utf8');

  if (leftBuffer.length !== rightBuffer.length) {
    return false;
  }

  return crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

function buildPasswordHash(salt, derivedKey) {
  return [
    ADMIN_PASSWORD_HASH_ALGORITHM,
    ADMIN_PASSWORD_HASH_VERSION,
    salt.toString('base64'),
    derivedKey.toString('base64'),
  ].join('$');
}

function parsePasswordHash(passwordHash) {
  if (typeof passwordHash !== 'string') {
    return null;
  }

  const parts = passwordHash.split('$');
  if (parts.length !== 4) {
    return null;
  }

  const [algorithm, version, saltBase64, keyBase64] = parts;
  if (
    !safeCompareText(algorithm, ADMIN_PASSWORD_HASH_ALGORITHM)
    || !safeCompareText(version, ADMIN_PASSWORD_HASH_VERSION)
  ) {
    return null;
  }

  return {
    salt: Buffer.from(saltBase64, 'base64'),
    expectedKey: Buffer.from(keyBase64, 'base64'),
  };
}

function derivePasswordKey(password, salt) {
  return crypto.scryptSync(
    password,
    salt,
    ADMIN_PASSWORD_KEY_LENGTH,
    ADMIN_PASSWORD_SCRYPT_OPTIONS,
  );
}

function isAdminPasswordHash(passwordHash) {
  return parsePasswordHash(passwordHash) !== null;
}

function hashAdminPassword(password, { randomBytes = crypto.randomBytes } = {}) {
  if (typeof password !== 'string' || password.length === 0) {
    throw new TypeError('管理员密码必须是非空字符串');
  }

  const salt = randomBytes(ADMIN_PASSWORD_SALT_LENGTH);
  const derivedKey = derivePasswordKey(password, salt);
  return buildPasswordHash(salt, derivedKey);
}

function verifyAdminPasswordHash(password, passwordHash) {
  if (typeof password !== 'string' || password.length === 0) {
    return false;
  }

  const parsed = parsePasswordHash(passwordHash);
  if (!parsed) {
    return false;
  }

  const actualKey = derivePasswordKey(password, parsed.salt);

  if (actualKey.length !== parsed.expectedKey.length) {
    return false;
  }

  return crypto.timingSafeEqual(actualKey, parsed.expectedKey);
}

function normalizeAdminPasswordConfig(adminConfig, { randomBytes = crypto.randomBytes } = {}) {
  const nextAdminConfig = { ...(adminConfig || {}) };

  if (isAdminPasswordHash(nextAdminConfig.passwordHash)) {
    if ('password' in nextAdminConfig) {
      delete nextAdminConfig.password;
      return {
        adminConfig: nextAdminConfig,
        changed: true,
      };
    }

    return {
      adminConfig: nextAdminConfig,
      changed: false,
    };
  }

  if (typeof nextAdminConfig.password === 'string' && nextAdminConfig.password.length > 0) {
    nextAdminConfig.passwordHash = hashAdminPassword(nextAdminConfig.password, { randomBytes });
    delete nextAdminConfig.password;
    return {
      adminConfig: nextAdminConfig,
      changed: true,
    };
  }

  return {
    adminConfig: nextAdminConfig,
    changed: false,
  };
}

export {
  hashAdminPassword,
  isAdminPasswordHash,
  normalizeAdminPasswordConfig,
  safeCompareText,
  verifyAdminPasswordHash,
};
