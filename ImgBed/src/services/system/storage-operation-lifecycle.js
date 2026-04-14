import {
  createStorageOperation,
  insertQuotaEvents,
  markOperationCommitted,
  markOperationCompensated,
  markOperationCompensationPending,
  markOperationCompleted,
  markOperationFailed,
  markOperationRemoteDone,
} from './storage-operations.js';

const COMMIT_FAILURE_MODE = Object.freeze({
  COMPENSATION_PENDING: 'compensation_pending',
  LEAVE_REMOTE_DONE: 'leave_remote_done',
});

async function runImmediateCompensation({
  db,
  operationId,
  compensationPayload,
  executeCompensation,
  markFailureOnCompensationError = false,
} = {}) {
  if (typeof executeCompensation !== 'function') {
    return { compensated: false, error: null };
  }

  try {
    await executeCompensation();
    markOperationCompensated(db, operationId, { compensationPayload });
    return { compensated: true, error: null };
  } catch (error) {
    if (markFailureOnCompensationError) {
      markOperationFailed(db, operationId, error);
    }

    return { compensated: false, error };
  }
}

function createStorageOperationLifecycle({
  db,
  storageManager = null,
  operationType,
  fileId = null,
  sourceStorageId = null,
  targetStorageId = null,
  payload = null,
} = {}) {
  if (!db) {
    throw new Error('创建存储操作生命周期时缺少数据库实例');
  }
  if (!operationType) {
    throw new Error('创建存储操作生命周期时缺少 operationType');
  }

  const operationId = createStorageOperation(db, {
    operationType,
    fileId,
    sourceStorageId,
    targetStorageId,
    payload,
  });

  async function applyQuotaEvents() {
    if (!storageManager?.applyPendingQuotaEvents) {
      return { applied: 0, storageIds: [] };
    }

    return storageManager.applyPendingQuotaEvents({
      operationId,
      adjustUsageStats: true,
    });
  }

  function markRemoteDone({
    sourceStorageId: nextSourceStorageId = sourceStorageId,
    targetStorageId: nextTargetStorageId = targetStorageId,
    remotePayload = payload,
  } = {}) {
    markOperationRemoteDone(db, operationId, {
      sourceStorageId: nextSourceStorageId,
      targetStorageId: nextTargetStorageId,
      remotePayload,
    });

    return operationId;
  }

  async function failBeforeCommit({
    error,
    compensationPayload = null,
    sourceStorageId: nextSourceStorageId = sourceStorageId,
    targetStorageId: nextTargetStorageId = targetStorageId,
    executeCompensation = null,
    markFailureOnCompensationError = false,
    rethrow = true,
  } = {}) {
    markOperationCompensationPending(db, operationId, {
      sourceStorageId: nextSourceStorageId,
      targetStorageId: nextTargetStorageId,
      compensationPayload,
      error,
    });

    const compensationResult = await runImmediateCompensation({
      db,
      operationId,
      compensationPayload,
      executeCompensation,
      markFailureOnCompensationError,
    });

    if (rethrow && error) {
      throw error;
    }
    if (compensationResult.error) {
      throw compensationResult.error;
    }

    return {
      operationId,
      status: compensationResult.compensated ? 'compensated' : 'compensation_pending',
    };
  }

  async function commit({
    persist = null,
    quotaEvents = [],
    compensationPayload = null,
    committedCompensationPayload = compensationPayload,
    failureCompensationPayload = committedCompensationPayload,
    sourceStorageId: nextSourceStorageId = sourceStorageId,
    targetStorageId: nextTargetStorageId = targetStorageId,
    onCommitFailure = COMMIT_FAILURE_MODE.COMPENSATION_PENDING,
    executeCompensation = null,
    markFailureOnCompensationError = false,
    afterCommit = null,
  } = {}) {
    const commitTransaction = db.transaction(() => {
      if (typeof persist === 'function') {
        persist();
      }

      if (Array.isArray(quotaEvents) && quotaEvents.length > 0) {
        insertQuotaEvents(db, quotaEvents);
      }

      markOperationCommitted(db, operationId, {
        sourceStorageId: nextSourceStorageId,
        targetStorageId: nextTargetStorageId,
        compensationPayload: committedCompensationPayload,
      });
    });

    try {
      commitTransaction();
    } catch (error) {
      if (onCommitFailure === COMMIT_FAILURE_MODE.LEAVE_REMOTE_DONE) {
        throw error;
      }

      markOperationCompensationPending(db, operationId, {
        sourceStorageId: nextSourceStorageId,
        targetStorageId: nextTargetStorageId,
        compensationPayload: failureCompensationPayload,
        error,
      });

      const compensationResult = await runImmediateCompensation({
        db,
        operationId,
        compensationPayload: failureCompensationPayload,
        executeCompensation,
        markFailureOnCompensationError,
      });

      if (error) {
        throw error;
      }
      if (compensationResult.error) {
        throw compensationResult.error;
      }
    }

    await applyQuotaEvents();

    if (typeof afterCommit === 'function') {
      await afterCommit();
    }

    markOperationCompleted(db, operationId);

    return {
      operationId,
      status: 'completed',
    };
  }

  return {
    operationId,
    applyQuotaEvents,
    commit,
    failBeforeCommit,
    markRemoteDone,
  };
}

export {
  COMMIT_FAILURE_MODE,
  createStorageOperationLifecycle,
};
