function buildNewStorageChannel(body) {
  const {
    id,
    type,
    name,
    enabled = true,
    allowUpload = false,
    enableQuota,
    quotaLimitGB,
    disableThresholdPercent,
    config: storConfig = {},
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
    quotaLimitGB: enableQuota ? Number(quotaLimitGB) || 10 : null,
    disableThresholdPercent: enableQuota
      ? Math.max(1, Math.min(100, Number(disableThresholdPercent) || 95))
      : 95,
    enableSizeLimit: Boolean(body.enableSizeLimit),
    sizeLimitMB: Number(body.sizeLimitMB) || 10,
    enableChunking: Boolean(body.enableChunking),
    chunkSizeMB: Number(body.chunkSizeMB) || 5,
    maxChunks: Number(body.maxChunks) || 0,
    enableMaxLimit: Boolean(body.enableMaxLimit),
    maxLimitMB: Number(body.maxLimitMB) || 100,
    config: normalizedConfig,
  };
}

function validateStorageChannelInput(body, validTypes) {
  const { id, type, name } = body;

  if (!id || !/^[a-zA-Z0-9-]+$/.test(id)) {
    return { code: 400, message: '渠道 ID 不合法，仅允许字母、数字和连字符' };
  }

  if (!validTypes.includes(type)) {
    return { code: 400, message: `存储类型不合法，支持：${validTypes.join(', ')}` };
  }

  if (!name || !name.trim()) {
    return { code: 400, message: '渠道名称不能为空' };
  }

  return null;
}

export {
  buildNewStorageChannel,
  validateStorageChannelInput,
};
