/**
 * API Token 创建相关服务函数
 */

const { API_TOKEN_PERMISSIONS } = require('../../utils/apiToken');

/**
 * 校验 token 输入参数
 */
function validateTokenInput(body) {
  const name = String(body.name || '').trim();
  const permissions = body.permissions || [];
  const expiresMode = body.expiresMode === 'custom' ? 'custom' : 'never';
  const expiresAt = body.expiresAt ? new Date(body.expiresAt) : null;

  if (!name) {
    const error = new Error('Token 名称不能为空');
    error.status = 400;
    throw error;
  }

  if (permissions.length === 0) {
    const error = new Error('至少选择一项权限');
    error.status = 400;
    throw error;
  }

  if (!permissions.includes(API_TOKEN_PERMISSIONS.UPLOAD_IMAGE) && !permissions.includes(API_TOKEN_PERMISSIONS.FILES_READ)) {
    const error = new Error('权限配置无效');
    error.status = 400;
    throw error;
  }

  let normalizedExpiresAt = null;
  if (expiresMode === 'custom') {
    if (!expiresAt || Number.isNaN(expiresAt.getTime())) {
      const error = new Error('过期时间格式无效');
      error.status = 400;
      throw error;
    }
    if (expiresAt.getTime() <= Date.now()) {
      const error = new Error('过期时间必须晚于当前时间');
      error.status = 400;
      throw error;
    }
    normalizedExpiresAt = expiresAt.toISOString();
  }

  return {
    name,
    permissions,
    expiresAt: normalizedExpiresAt,
  };
}

/**
 * 创建 token 数据库记录
 */
function createTokenRecord(validated, plainToken, tokenPrefix, tokenHash, generateTokenId) {
  return {
    id: generateTokenId(),
    name: validated.name,
    token_prefix: tokenPrefix,
    token_hash: tokenHash,
    permissions: JSON.stringify(validated.permissions),
    status: 'active',
    expires_at: validated.expiresAt,
    created_by: 'admin',
  };
}

module.exports = {
  validateTokenInput,
  createTokenRecord,
};
