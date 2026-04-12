import { SignJWT, jwtVerify } from 'jose';

import { getLastKnownGoodConfig } from '../config/index.js';
import { createLogger } from './logger.js';

const log = createLogger('jwt');

function getJwtSettings() {
  return getLastKnownGoodConfig().jwt || {};
}

function getSecretKey() {
  const secret = getJwtSettings().secret || 'fallback-secret-key-12345678';
  return new TextEncoder().encode(secret);
}

function classifyJwtVerificationError(error) {
  const code = error?.code || '';
  const name = error?.name || '';

  if (code === 'ERR_JWS_SIGNATURE_VERIFICATION_FAILED' || name === 'JWSSignatureVerificationFailed') {
    return {
      ok: false,
      reason: 'signature_invalid',
      level: 'info',
      message: 'Token 验签失败，需重新登录',
      context: { code, name },
    };
  }

  if (code === 'ERR_JWT_EXPIRED' || name === 'JWTExpired') {
    return {
      ok: false,
      reason: 'expired',
      level: 'info',
      message: 'Token 已过期，需重新登录',
      context: { code, name },
    };
  }

  if (
    code === 'ERR_JWS_INVALID' ||
    code === 'ERR_JWT_INVALID' ||
    code === 'ERR_JWT_CLAIM_VALIDATION_FAILED' ||
    name === 'JWSInvalid' ||
    name === 'JWTInvalid' ||
    name === 'JWTClaimValidationFailed'
  ) {
    return {
      ok: false,
      reason: 'malformed',
      level: 'info',
      message: 'Token 无效，需重新登录',
      context: { code, name },
    };
  }

  return {
    ok: false,
    reason: 'unexpected',
    level: 'error',
    message: 'Token 解析失败',
    context: { err: error },
  };
}

async function signToken(payload) {
  const expiresIn = getJwtSettings().expiresIn || '7d';
  return new SignJWT(payload)
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(expiresIn)
    .sign(getSecretKey());
}

async function verifyToken(token) {
  try {
    const { payload } = await jwtVerify(token, getSecretKey());
    return {
      ok: true,
      payload,
    };
  } catch (error) {
    const classification = classifyJwtVerificationError(error);
    const loggerMethod = typeof log[classification.level] === 'function' ? log[classification.level] : log.error;

    loggerMethod.call(log, classification.context, classification.message);
    return classification;
  }
}

export {
  classifyJwtVerificationError,
  signToken,
  verifyToken,
};
