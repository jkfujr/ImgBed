/**
 * 认证服务 - 密码验证
 */

/**
 * 获取有效的管理员密码（优先从数据库读取，降级到配置文件）
 * @param {Object} db - 数据库实例
 * @param {string} configPassword - 配置文件中的密码
 * @returns {Promise<string>} 有效密码
 */
async function getEffectiveAdminPassword(db, configPassword) {
  try {
    const row = await db.selectFrom('system_settings')
      .select('value')
      .where('key', '=', 'admin_password')
      .executeTakeFirst();
    if (row) return row.value;
  } catch (_) {
    // 数据库未就绪时降级为 config 密码
  }
  return configPassword;
}

/**
 * 验证管理员凭据
 * @param {string} username - 用户名
 * @param {string} password - 密码
 * @param {Object} adminConfig - 管理员配置
 * @param {Object} db - 数据库实例
 * @returns {Promise<boolean>} 验证是否通过
 */
async function verifyAdminCredentials(username, password, adminConfig, db) {
  if (!username || !password) {
    return false;
  }

  const effectivePassword = await getEffectiveAdminPassword(db, adminConfig.password);
  return username === adminConfig.username && password === effectivePassword;
}

module.exports = {
  getEffectiveAdminPassword,
  verifyAdminCredentials,
};
