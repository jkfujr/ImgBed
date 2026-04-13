function parseJsonObject(rawJson) {
  if (!rawJson) {
    return {};
  }

  if (typeof rawJson === 'object') {
    return rawJson && !Array.isArray(rawJson) ? rawJson : {};
  }

  try {
    const parsed = JSON.parse(rawJson);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function normalizeDeleteToken(deleteToken) {
  if (!deleteToken || typeof deleteToken !== 'object' || Array.isArray(deleteToken)) {
    return null;
  }

  const normalized = {};

  if (deleteToken.messageId || deleteToken.message_id) {
    normalized.messageId = deleteToken.messageId || deleteToken.message_id;
  }
  if (deleteToken.chatId || deleteToken.chat_id) {
    normalized.chatId = deleteToken.chatId || deleteToken.chat_id;
  }
  if (deleteToken.channelId || deleteToken.channel_id) {
    normalized.channelId = deleteToken.channelId || deleteToken.channel_id;
  }
  if (deleteToken.attachmentId || deleteToken.attachment_id) {
    normalized.attachmentId = deleteToken.attachmentId || deleteToken.attachment_id;
  }
  if (deleteToken.messageIdPath) {
    normalized.messageIdPath = deleteToken.messageIdPath;
  }

  return Object.keys(normalized).length > 0 ? normalized : { ...deleteToken };
}

function extractLegacyDeleteToken(legacyMeta) {
  if (!legacyMeta || typeof legacyMeta !== 'object') {
    return null;
  }

  const extraResult = legacyMeta.extra_result && typeof legacyMeta.extra_result === 'object'
    ? legacyMeta.extra_result
    : legacyMeta;

  const normalized = normalizeDeleteToken(extraResult);
  if (!normalized) {
    return null;
  }

  if (normalized.messageId || normalized.chatId || normalized.channelId || normalized.attachmentId) {
    return normalized;
  }

  return null;
}

function parseStorageMeta(storageMeta, legacyStorageConfig = null) {
  const currentMeta = parseJsonObject(storageMeta);
  const legacyMeta = parseJsonObject(legacyStorageConfig);
  const deleteToken = normalizeDeleteToken(currentMeta.deleteToken)
    || extractLegacyDeleteToken(currentMeta)
    || extractLegacyDeleteToken(legacyMeta);

  return {
    deleteToken,
  };
}

function serializeStorageMeta({ deleteToken = null } = {}) {
  const normalizedDeleteToken = normalizeDeleteToken(deleteToken);
  if (!normalizedDeleteToken) {
    return null;
  }

  return JSON.stringify({
    deleteToken: normalizedDeleteToken,
  });
}

function resolveStorageInstanceId(record) {
  if (record?.storage_instance_id) {
    return record.storage_instance_id;
  }

  const currentMeta = parseJsonObject(record?.storage_meta);
  if (currentMeta.instanceId || currentMeta.instance_id) {
    return currentMeta.instanceId || currentMeta.instance_id;
  }

  const legacyMeta = parseJsonObject(record?.storage_config);
  return legacyMeta.instance_id || legacyMeta.instanceId || null;
}

export {
  extractLegacyDeleteToken,
  normalizeDeleteToken,
  parseJsonObject,
  parseStorageMeta,
  resolveStorageInstanceId,
  serializeStorageMeta,
};
