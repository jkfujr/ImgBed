import { SignJWT, jwtVerify } from 'jose';
import config from '../config/index.js';
import { createLogger } from './logger.js';

const log = createLogger('jwt');

// 将配置中的密钥转换为 Uint8Array
const secretKey = new TextEncoder().encode(config.jwt?.secret || 'fallback-secret-key-12345678');

/**
 * 生成 JWT
 * @param {Object} payload 载荷信息
 * @returns {Promise<string>} 生成的 Token
 */
async function signToken(payload) {
  const expiresIn = config.jwt?.expiresIn || '7d';
  return await new SignJWT(payload)
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(expiresIn)
    .sign(secretKey);
}

/**
 * 验证和解析 JWT
 * @param {string} token 客户端传入的 Bearer Token
 * @returns {Promise<Object|null>} 若成功返回载荷对象，否则返回 null
 */
async function verifyToken(token) {
  try {
    const { payload } = await jwtVerify(token, secretKey);
    return payload; // 解析成功，返回其中的数据
  } catch (error) {
    log.error({ err: error }, 'Token 解析失败或已变质/过期');
    return null; // 验证失败
  }
}

export { signToken,
  verifyToken };
