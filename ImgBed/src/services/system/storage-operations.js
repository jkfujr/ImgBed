import crypto from 'crypto';

const OPERATION_STATUS = Object.freeze({
  PENDING: 'pending',
  REMOTE_DONE: 'remote_done',
  COMMITTED: 'committed',
  COMPLETED: 'completed',
  COMPENSATION_PENDING: 'compensation_pending',
  COMPENSATED: 'compensated',
  FAILED: 'failed',
});

function serializeJson(value) {
  if (value === undefined) return undefined;
  if (value === null) return null;
  return JSON.stringify(value);
}

function readOperation(db, operationId) {
  const row = db.prepare('SELECT * FROM storage_operations WHERE id = ? LIMIT 1').get(operationId);
  if (!row) {
    throw new Error(`存储操作不存在: ${operationId}`);
  }
  return row;
}

function updateStorageOperation(db, operationId, changes = {}) {
  const current = readOperation(db, operationId);
  const next = {
    id: operationId,
    status: changes.status ?? current.status,
    source_storage_id: changes.sourceStorageId ?? current.source_storage_id ?? null,
    target_storage_id: changes.targetStorageId ?? current.target_storage_id ?? null,
    remote_payload: changes.remotePayload === undefined ? current.remote_payload : serializeJson(changes.remotePayload),
    compensation_payload: changes.compensationPayload === undefined ? current.compensation_payload : serializeJson(changes.compensationPayload),
    error_message: changes.errorMessage === undefined ? current.error_message : changes.errorMessage,
    retry_count: changes.retryCount === undefined ? (current.retry_count ?? 0) : changes.retryCount,
  };

  db.prepare(`UPDATE storage_operations SET
    status = @status,
    source_storage_id = @source_storage_id,
    target_storage_id = @target_storage_id,
    remote_payload = @remote_payload,
    compensation_payload = @compensation_payload,
    error_message = @error_message,
    retry_count = @retry_count
    WHERE id = @id`).run(next);
}

function incrementOperationRetryCount(db, operationId) {
  db.prepare(
    'UPDATE storage_operations SET retry_count = COALESCE(retry_count, 0) + 1 WHERE id = ?'
  ).run(operationId);
}

function createStorageOperation(db, {
  operationType,
  fileId = null,
  sourceStorageId = null,
  targetStorageId = null,
  payload = null,
  status = OPERATION_STATUS.PENDING,
} = {}) {
  if (!operationType) {
    throw new Error('创建存储操作时必须提供操作类型');
  }

  const operationId = crypto.randomUUID();
  db.prepare(`INSERT INTO storage_operations (
    id, operation_type, file_id, status,
    source_storage_id, target_storage_id,
    remote_payload, compensation_payload, error_message
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(
      operationId,
      operationType,
      fileId,
      status,
      sourceStorageId,
      targetStorageId,
      serializeJson(payload) ?? null,
      null,
      null,
    );

  return operationId;
}

function normalizeErrorMessage(error) {
  if (!error) return null;
  return error.message || String(error);
}

function markOperationRemoteDone(db, operationId, {
  sourceStorageId,
  targetStorageId,
  remotePayload,
} = {}) {
  updateStorageOperation(db, operationId, {
    status: OPERATION_STATUS.REMOTE_DONE,
    sourceStorageId,
    targetStorageId,
    remotePayload,
    errorMessage: null,
  });
}

function markOperationCommitted(db, operationId, {
  sourceStorageId,
  targetStorageId,
  compensationPayload,
} = {}) {
  updateStorageOperation(db, operationId, {
    status: OPERATION_STATUS.COMMITTED,
    sourceStorageId,
    targetStorageId,
    compensationPayload,
    errorMessage: null,
  });
}

function markOperationCompleted(db, operationId, {
  compensationPayload,
} = {}) {
  updateStorageOperation(db, operationId, {
    status: OPERATION_STATUS.COMPLETED,
    compensationPayload: compensationPayload ?? null,
    errorMessage: null,
  });
}

function markOperationCompensationPending(db, operationId, {
  sourceStorageId,
  targetStorageId,
  compensationPayload,
  error,
} = {}) {
  updateStorageOperation(db, operationId, {
    status: OPERATION_STATUS.COMPENSATION_PENDING,
    sourceStorageId,
    targetStorageId,
    compensationPayload,
    errorMessage: normalizeErrorMessage(error),
  });
}

function markOperationCompensated(db, operationId, {
  compensationPayload,
} = {}) {
  updateStorageOperation(db, operationId, {
    status: OPERATION_STATUS.COMPENSATED,
    compensationPayload: compensationPayload ?? null,
    errorMessage: null,
  });
}

function markOperationFailed(db, operationId, error) {
  updateStorageOperation(db, operationId, {
    status: OPERATION_STATUS.FAILED,
    errorMessage: normalizeErrorMessage(error),
  });
}

function buildQuotaEvent({
  operationId,
  fileId = null,
  storageId,
  eventType,
  bytesDelta,
  fileCountDelta = 0,
  payload = null,
  idempotencyKey = null,
} = {}) {
  if (!operationId || !storageId || !eventType) {
    throw new Error('构建容量事件时缺少必要字段');
  }

  return {
    operation_id: operationId,
    file_id: fileId,
    storage_id: storageId,
    event_type: eventType,
    bytes_delta: Number(bytesDelta) || 0,
    file_count_delta: Number(fileCountDelta) || 0,
    idempotency_key: idempotencyKey || `${operationId}:${eventType}:${storageId}:${fileId || 'no-file'}`,
    payload: serializeJson(payload) ?? null,
  };
}

function insertQuotaEvents(db, events = []) {
  if (!Array.isArray(events) || events.length === 0) {
    return;
  }

  const stmt = db.prepare(`INSERT INTO storage_quota_events (
    operation_id, file_id, storage_id, event_type,
    bytes_delta, file_count_delta, idempotency_key, payload
  ) VALUES (
    @operation_id, @file_id, @storage_id, @event_type,
    @bytes_delta, @file_count_delta, @idempotency_key, @payload
  )`);

  for (const event of events) {
    stmt.run(event);
  }
}

export {
  OPERATION_STATUS,
  buildQuotaEvent,
  createStorageOperation,
  incrementOperationRetryCount,
  insertQuotaEvents,
  markOperationCommitted,
  markOperationCompensated,
  markOperationCompensationPending,
  markOperationCompleted,
  markOperationFailed,
  markOperationRemoteDone,
  normalizeErrorMessage,
  updateStorageOperation,
};
