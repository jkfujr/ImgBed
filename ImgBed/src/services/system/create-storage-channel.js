/**
 * 创建新存储渠道的字段构建
 */

/**
 * 构建新存储渠道对象
 * @param {Object} body - 请求体
 * @returns {Object} 新存储渠道对象
 */
function buildNewStorageChannel(body) {
  const {
    id, type, name, enabled = true, allowUpload = false,
    weight = 1,
    enableQuota,
    quotaLimitGB,
    disableThresholdPercent,
    config: storConfig = {}
  } = body;

  const normalizedConfig = { ...storConfig };
  if (type === 's3' && Object.prototype.hasOwnProperty.call(normalizedConfig, 'pathStyle')) {
    normalizedConfig.pathStyle = normalizedConfig.pathStyle === true || normalizedConfig.pathStyle === 'true';
  }

  return {
    id,
    type,
    name,
    enabled: Boolean(enabled),
    allowUpload: Boolean(allowUpload),
    weight: body.weight ?? 1,
    // 配额处理 - enableQuota=false 时存 null 表示不限制
    quotaLimitGB: enableQuota ? Number(quotaLimitGB) || 10 : null,
    disableThresholdPercent: enableQuota ? (Math.max(1, Math.min(100, Number(disableThresholdPercent) || 95))) : 95,
    // 大小限制
    enableSizeLimit: Boolean(body.enableSizeLimit),
    sizeLimitMB: Number(body.sizeLimitMB) || 10,
    // 分片上传
    enableChunking: Boolean(body.enableChunking),
    chunkSizeMB: Number(body.chunkSizeMB) || 5,
    maxChunks: Number(body.maxChunks) || 0,
    // 最大限制
    enableMaxLimit: Boolean(body.enableMaxLimit),
    maxLimitMB: Number(body.maxLimitMB) || 100,
    config: normalizedConfig
  };
}

/**
 * 验证存储渠道输入
 * @param {Object} body - 请求体
 * @param {Array} validTypes - 有效的存储类型列表
 * @returns {Object|null} 如果验证失败返回错误对象，否则返回 null
 */
function validateStorageChannelInput(body, validTypes) {
  const { id, type, name } = body;

  if (!id || !/^[a-zA-Z0-9-]+$/.test(id)) {
    return { code: 400, message: 'id 不合法，仅允许字母、数字、连字符' };
  }
  if (!validTypes.includes(type)) {
    return { code: 400, message: `type 不合法，支持：${validTypes.join(', ')}` };
  }
  if (!name || !name.trim()) {
    return { code: 400, message: 'name 不能为空' };
  }

  return null; // 验证通过
}

export { buildNewStorageChannel,
  validateStorageChannelInput, };
