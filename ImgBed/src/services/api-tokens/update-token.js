/**
 * API Token 更新相关服务函数
 */

import { normalizePermissions, parsePermissions } from '../../utils/apiToken.js';

/**
 * 校验 token 更新输入参数
 * @param {Object} body - 请求体
 * @param {Object} existingToken - 现有 token 记录
 * @returns {Object} 验证后的数据
 */
function validateTokenUpdateInput(body, existingToken) {
  const name = body.name !== undefined ? String(body.name || '').trim() : existingToken.name;
  const permissions = body.permissions !== undefined ? body.permissions : parsePermissions(existingToken.permissions);
  const expiresMode = body.expiresMode;
  const expiresAt = body.expiresAt;

  // 名称验证
  if (!name) {
    const error = new Error('Token 名称不能为空');
    error.status = 400;
    throw error;
  }

  // 权限验证
  if (permissions.length === 0) {
    const error = new Error('至少选择一项权限');
    error.status = 400;
    throw error;
  }

  // 验证权限有效性
  const validPermissions = normalizePermissions(permissions);
  if (validPermissions.length === 0) {
    const error = new Error('权限配置无效');
    error.status = 400;
    throw error;
  }

  // 过期时间处理
  let normalizedExpiresAt = existingToken.expires_at;
  if (expiresMode === 'never') {
    normalizedExpiresAt = null;
  } else if (expiresMode === 'custom') {
    const expiresDate = new Date(expiresAt);
    if (!expiresAt || Number.isNaN(expiresDate.getTime())) {
      const error = new Error('过期时间格式无效');
      error.status = 400;
      throw error;
    }
    if (expiresDate.getTime() <= Date.now()) {
      const error = new Error('过期时间必须晚于当前时间');
      error.status = 400;
      throw error;
    }
    normalizedExpiresAt = expiresDate.toISOString();
  }

  return {
    name,
    permissions: validPermissions,
    expiresAt: normalizedExpiresAt,
  };
}

export { validateTokenUpdateInput };
