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

  if (deleteToken.messageId) {
    normalized.messageId = deleteToken.messageId;
  }
  if (deleteToken.chatId) {
    normalized.chatId = deleteToken.chatId;
  }
  if (deleteToken.channelId) {
    normalized.channelId = deleteToken.channelId;
  }
  if (deleteToken.attachmentId) {
    normalized.attachmentId = deleteToken.attachmentId;
  }
  if (deleteToken.messageIdPath) {
    normalized.messageIdPath = deleteToken.messageIdPath;
  }

  return Object.keys(normalized).length > 0 ? normalized : { ...deleteToken };
}

function parseStorageMeta(storageMeta) {
  const currentMeta = parseJsonObject(storageMeta);
  const deleteToken = normalizeDeleteToken(currentMeta.deleteToken);

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
  return record?.storage_instance_id || null;
}

export {
  normalizeDeleteToken,
  parseJsonObject,
  parseStorageMeta,
  resolveStorageInstanceId,
  serializeStorageMeta,
};
