import { SignJWT, jwtVerify } from 'jose';

import config from '../config/index.js';
import { createLogger } from './logger.js';

const log = createLogger('jwt');
const secretKey = new TextEncoder().encode(config.jwt?.secret || 'fallback-secret-key-12345678');

function classifyJwtVerificationError(error) {
  const code = error?.code || '';
  const name = error?.name || '';

  if (code === 'ERR_JWS_SIGNATURE_VERIFICATION_FAILED' || name === 'JWSSignatureVerificationFailed') {
    return {
      level: 'info',
      message: 'Token 验签失败，需重新登录',
      context: { code, name },
    };
  }

  if (code === 'ERR_JWT_EXPIRED' || name === 'JWTExpired') {
    return {
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
      level: 'info',
      message: 'Token 无效，需重新登录',
      context: { code, name },
    };
  }

  return {
    level: 'error',
    message: 'Token 解析失败',
    context: { err: error },
  };
}

async function signToken(payload) {
  const expiresIn = config.jwt?.expiresIn || '7d';
  return await new SignJWT(payload)
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(expiresIn)
    .sign(secretKey);
}

async function verifyToken(token) {
  try {
    const { payload } = await jwtVerify(token, secretKey);
    return payload;
  } catch (error) {
    const classification = classifyJwtVerificationError(error);
    const loggerMethod = typeof log[classification.level] === 'function' ? log[classification.level] : log.error;
    loggerMethod.call(log, classification.context, classification.message);
    return null;
  }
}

export {
  classifyJwtVerificationError,
  signToken,
  verifyToken,
};
