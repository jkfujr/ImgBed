import {
  isAdminPasswordHash,
  safeCompareText,
  verifyAdminPasswordHash,
} from '../../utils/admin-password.js';

/**
 * 认证服务 - 密码验证
 */

/**
 * 验证管理员凭据
 * @param {string} username - 用户名
 * @param {string} password - 密码
 * @param {Object} adminConfig - 管理员配置
 * @returns {Promise<boolean>} 验证是否通过
 */
async function verifyAdminCredentials(username, password, adminConfig) {
  if (!username || !password) {
    return false;
  }

  if (!safeCompareText(username, adminConfig?.username || '')) {
    return false;
  }

  if (isAdminPasswordHash(adminConfig?.passwordHash)) {
    return verifyAdminPasswordHash(password, adminConfig.passwordHash);
  }

  return safeCompareText(password, adminConfig?.password || '');
}

export { verifyAdminCredentials };
