function normalizeDeleteToken(deleteToken) {
  return deleteToken && typeof deleteToken === 'object' && !Array.isArray(deleteToken)
    ? deleteToken
    : null;
}

function normalizeChunkRecords(chunkRecords) {
  return Array.isArray(chunkRecords) ? chunkRecords : [];
}

function buildStorageArtifactPayload({
  storageKey,
  deleteToken = null,
  isChunked = false,
  chunkRecords = [],
  deleteMode = undefined,
} = {}) {
  const payload = {
    storageKey: storageKey ? String(storageKey) : null,
    deleteToken: normalizeDeleteToken(deleteToken),
    isChunked: Boolean(isChunked),
    chunkRecords: normalizeChunkRecords(chunkRecords),
  };

  if (deleteMode !== undefined) {
    payload.deleteMode = deleteMode;
  }

  return payload;
}

function resolveOperationStorageId(operation, { payloadField = 'compensation_payload' } = {}) {
  if (payloadField === 'remote_payload') {
    return operation?.target_storage_id || null;
  }

  if (operation?.operation_type === 'delete') {
    return operation?.source_storage_id || null;
  }

  if (operation?.operation_type === 'upload') {
    return operation?.target_storage_id || null;
  }

  if (operation?.operation_type === 'migrate') {
    return operation?.status === 'committed'
      ? (operation?.source_storage_id || null)
      : (operation?.target_storage_id || null);
  }

  return operation?.target_storage_id || operation?.source_storage_id || null;
}

export {
  buildStorageArtifactPayload,
  resolveOperationStorageId,
};
