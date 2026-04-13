import { createLogger } from '../../utils/logger.js';
import { removeStoredArtifacts } from '../../services/files/storage-artifacts.js';
import {
  buildQuotaEvent,
  incrementOperationRetryCount,
  insertQuotaEvents,
  markOperationCommitted,
  markOperationCompensated,
  markOperationCompleted,
  markOperationFailed,
} from '../../services/system/storage-operations.js';

const log = createLogger('storage');

class StorageOperationRecovery {
  constructor({
    db,
    logger = log,
    storageManager,
    applyPendingQuotaEvents,
  } = {}) {
    this.db = db;
    this.log = logger;
    this.storageManager = storageManager;
    this.applyPendingQuotaEvents = applyPendingQuotaEvents;
    this.isRecoveryRunning = false;
  }

  parseOperationPayload(rawPayload) {
    if (!rawPayload) {
      return {};
    }

    try {
      return JSON.parse(rawPayload);
    } catch {
      return {};
    }
  }

  async recoverPendingOperations({ limit = 50 } = {}) {
    const db = this.db;

    if (this.isRecoveryRunning) {
      return { recovered: 0, total: 0, skipped: true };
    }

    this.isRecoveryRunning = true;

    try {
      const operations = db.prepare(`
        SELECT * FROM storage_operations
        WHERE status IN ('remote_done', 'committed', 'compensation_pending')
        ORDER BY created_at ASC
        LIMIT ?
      `).all(limit);

      if (operations.length === 0) {
        return { recovered: 0, total: 0, skipped: false };
      }

      this.log.info({ count: operations.length }, '恢复扫描发现待处理的过期存储操作');

      let recovered = 0;
      for (const operation of operations) {
        const current = db.prepare(
          'SELECT status FROM storage_operations WHERE id = ? LIMIT 1'
        ).get(operation.id);

        if (!current || current.status !== operation.status) {
          continue;
        }

        await this.executeRecovery(operation);
        recovered++;
      }

      return { recovered, total: operations.length, skipped: false };
    } finally {
      this.isRecoveryRunning = false;
    }
  }

  async executeRecovery(operation) {
    const db = this.db;
    const MAX_RETRIES = 5;
    const retryCount = operation.retry_count ?? 0;

    if (retryCount >= MAX_RETRIES) {
      markOperationFailed(db, operation.id, new Error(`重试次数已超过上限 ${MAX_RETRIES}`));
      this.log.warn({ operationId: operation.id, retryCount }, '恢复任务超过最大重试次数，已终止');
      return;
    }

    try {
      switch (operation.status) {
        case 'remote_done':
          await this.recoverRemoteDoneOperation(operation);
          break;
        case 'committed':
          await this.recoverCommittedOperation(operation);
          break;
        case 'compensation_pending':
          await this.executeCompensation(operation);
          break;
        default:
          break;
      }
    } catch (err) {
      incrementOperationRetryCount(db, operation.id);
      this.log.error({ operationId: operation.id, retryCount: retryCount + 1, err }, '恢复执行失败');
    }
  }

  async recoverRemoteDoneOperation(operation) {
    const db = this.db;

    if (operation.operation_type !== 'delete') {
      await this.executeCompensation(operation, { payloadField: 'remote_payload' });
      return;
    }

    const fileRecord = db.prepare('SELECT * FROM files WHERE id = ? LIMIT 1').get(operation.file_id);
    if (!fileRecord) {
      markOperationCompleted(db, operation.id);
      return;
    }

    const instanceId = operation.source_storage_id || fileRecord.storage_instance_id || null;
    const fileSize = Number(fileRecord.size) || 0;
    const chunkRecords = fileRecord.is_chunked
      ? db.prepare('SELECT * FROM chunks WHERE file_id = ? ORDER BY chunk_index ASC').all(fileRecord.id)
      : [];

    const compensationPayload = {
      storageId: instanceId,
      storageKey: fileRecord.storage_key,
      isChunked: Boolean(fileRecord.is_chunked),
      chunkRecords,
    };

    const persistDelete = db.transaction(() => {
      db.prepare('DELETE FROM chunks WHERE file_id = ?').run(fileRecord.id);
      db.prepare('DELETE FROM files WHERE id = ?').run(fileRecord.id);

      if (instanceId) {
        insertQuotaEvents(db, [buildQuotaEvent({
          operationId: operation.id,
          fileId: fileRecord.id,
          storageId: instanceId,
          eventType: 'delete',
          bytesDelta: -fileSize,
          fileCountDelta: -1,
          payload: { storageKey: fileRecord.storage_key },
        })]);
      }

      markOperationCommitted(db, operation.id, {
        sourceStorageId: instanceId,
        compensationPayload,
      });
    });

    persistDelete();
    await this.applyPendingQuotaEvents({ operationId: operation.id, adjustUsageStats: true });
    markOperationCompleted(db, operation.id);
    this.log.info({ operationId: operation.id }, '已恢复远端已完成状态的删除操作');
  }

  async recoverCommittedOperation(operation) {
    const db = this.db;

    await this.applyPendingQuotaEvents({ operationId: operation.id, adjustUsageStats: true });

    if (operation.operation_type === 'migrate' && operation.compensation_payload) {
      const payload = this.parseOperationPayload(operation.compensation_payload);
      await removeStoredArtifacts({
        storageManager: this.storageManager,
        storageId: payload.storageId || payload.sourceStorageId,
        storageKey: payload.storageKey || payload.sourceStorageKey,
        isChunked: Boolean(payload.isChunked),
        chunkRecords: payload.chunkRecords || [],
        deleteMode: payload.deleteMode,
        tgOptions: payload.tgOptions || {},
      });
    }

    markOperationCompleted(db, operation.id);
    this.log.info({ operationId: operation.id }, '已恢复已提交状态的存储操作');
  }

  async executeCompensation(operation, { payloadField = 'compensation_payload' } = {}) {
    const db = this.db;
    const payload = this.parseOperationPayload(operation[payloadField]);
    if (!payload || Object.keys(payload).length === 0) {
      markOperationCompensated(db, operation.id, { compensationPayload: payload });
      return;
    }

    await removeStoredArtifacts({
      storageManager: this.storageManager,
      storageId: payload.storageId || payload.sourceStorageId || payload.targetStorageId,
      storageKey: payload.storageKey || payload.sourceStorageKey || payload.targetStorageKey,
      isChunked: Boolean(payload.isChunked),
      chunkRecords: payload.chunkRecords || [],
      deleteMode: payload.deleteMode,
      tgOptions: payload.tgOptions || {},
    });

    markOperationCompensated(db, operation.id, { compensationPayload: payload });
    this.log.info({ operationId: operation.id }, '补偿执行完成');
  }
}

export { StorageOperationRecovery };
