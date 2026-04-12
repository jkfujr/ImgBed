import { sqlite } from '../../database/index.js';
import { createLogger } from '../../utils/logger.js';

const log = createLogger('quota-events-archive');

class QuotaEventsArchive {
  constructor(options = {}) {
    this.enabled = options.enabled !== false;
    this.retentionDays = options.retentionDays || 30;
    this.batchSize = options.batchSize || 500;
    this.maxBatchesPerRun = options.maxBatchesPerRun || 10;
    this.stats = {
      totalArchived: 0,
      totalDeleted: 0,
      lastRunAt: null,
      lastRunDuration: 0,
      lastRunBatches: 0,
      errors: 0,
    };
  }

  async archive() {
    if (!this.enabled) {
      log.info('容量事件归档服务已禁用');
      return { archived: 0, deleted: 0, batches: 0 };
    }

    const startTime = Date.now();
    let totalArchived = 0;
    let totalDeleted = 0;
    let batchCount = 0;

    try {
      log.info({ retentionDays: this.retentionDays, batchSize: this.batchSize }, '开始执行容量事件归档');

      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - this.retentionDays);
      const cutoffTimestamp = cutoffDate.toISOString();

      for (let i = 0; i < this.maxBatchesPerRun; i++) {
        const result = this._archiveBatch(cutoffTimestamp);

        if (result.archived === 0) {
          log.info('没有更多需要归档的容量事件');
          break;
        }

        totalArchived += result.archived;
        totalDeleted += result.deleted;
        batchCount++;

        log.info({
          batch: i + 1,
          archived: result.archived,
          deleted: result.deleted,
        }, '归档批次完成');
      }

      const duration = Date.now() - startTime;

      this.stats.totalArchived += totalArchived;
      this.stats.totalDeleted += totalDeleted;
      this.stats.lastRunAt = new Date().toISOString();
      this.stats.lastRunDuration = duration;
      this.stats.lastRunBatches = batchCount;

      log.info({
        totalArchived,
        totalDeleted,
        batchCount,
        duration,
      }, '容量事件归档完成');

      return {
        archived: totalArchived,
        deleted: totalDeleted,
        batches: batchCount,
        duration,
      };
    } catch (error) {
      this.stats.errors++;
      log.error({ err: error }, '容量事件归档失败');
      throw error;
    }
  }

  _archiveBatch(cutoffTimestamp) {
    const archiveBatch = sqlite.transaction(() => {
      const candidates = sqlite.prepare(`
        SELECT
          id, operation_id, file_id, storage_id, event_type,
          bytes_delta, file_count_delta, idempotency_key, payload,
          applied_at, created_at
        FROM storage_quota_events
        WHERE applied_at IS NOT NULL
          AND applied_at < ?
        ORDER BY applied_at ASC
        LIMIT ?
      `).all(cutoffTimestamp, this.batchSize);

      if (candidates.length === 0) {
        return { archived: 0, deleted: 0 };
      }

      const insertStmt = sqlite.prepare(`
        INSERT INTO storage_quota_events_archive (
          id, operation_id, file_id, storage_id, event_type,
          bytes_delta, file_count_delta, idempotency_key, payload,
          applied_at, created_at, archived_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
      `);

      for (const event of candidates) {
        insertStmt.run(
          event.id,
          event.operation_id,
          event.file_id,
          event.storage_id,
          event.event_type,
          event.bytes_delta,
          event.file_count_delta,
          event.idempotency_key,
          event.payload,
          event.applied_at,
          event.created_at
        );
      }

      const archivedCount = sqlite.prepare(`
        SELECT COUNT(*) as count
        FROM storage_quota_events_archive
        WHERE id IN (${candidates.map(() => '?').join(',')})
      `).get(...candidates.map((e) => e.id)).count;

      if (archivedCount !== candidates.length) {
        throw new Error(`归档数量不匹配：预期 ${candidates.length}，实际 ${archivedCount}`);
      }

      const deleteStmt = sqlite.prepare(`
        DELETE FROM storage_quota_events
        WHERE id IN (${candidates.map(() => '?').join(',')})
      `);

      const deleteResult = deleteStmt.run(...candidates.map((e) => e.id));

      return {
        archived: archivedCount,
        deleted: deleteResult.changes,
      };
    });

    return archiveBatch();
  }

  getStats() {
    const activeCount = sqlite.prepare('SELECT COUNT(*) as count FROM storage_quota_events').get().count;
    const archiveCount = sqlite.prepare('SELECT COUNT(*) as count FROM storage_quota_events_archive').get().count;
    const appliedCount = sqlite.prepare('SELECT COUNT(*) as count FROM storage_quota_events WHERE applied_at IS NOT NULL').get().count;
    const pendingCount = sqlite.prepare('SELECT COUNT(*) as count FROM storage_quota_events WHERE applied_at IS NULL').get().count;

    return {
      ...this.stats,
      activeEvents: activeCount,
      archivedEvents: archiveCount,
      appliedEvents: appliedCount,
      pendingEvents: pendingCount,
      enabled: this.enabled,
    };
  }

  clearArchive() {
    const result = sqlite.prepare('DELETE FROM storage_quota_events_archive').run();
    log.warn({ deleted: result.changes }, '容量事件归档表已清空');
    return result.changes;
  }
}

let archiveInstance = null;

export function initQuotaEventsArchive(options = {}) {
  archiveInstance = new QuotaEventsArchive(options);
  log.info({
    enabled: archiveInstance.enabled,
    retentionDays: archiveInstance.retentionDays,
    batchSize: archiveInstance.batchSize,
  }, '容量事件归档服务已初始化');
}

export function getQuotaEventsArchive() {
  if (!archiveInstance) {
    throw new Error('容量事件归档服务尚未初始化，请先调用 initQuotaEventsArchive()');
  }
  return archiveInstance;
}

export default QuotaEventsArchive;
