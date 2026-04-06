import { sqlite } from '../../database/index.js';
import { createLogger } from '../../utils/logger.js';

const log = createLogger('quota-events-archive');

/**
 * 事件表归档服务
 *
 * 职责：
 * 1. 将已应用的历史事件从活跃表迁移到归档表
 * 2. 控制活跃表规模，保证恢复路径高效
 * 3. 保留完整审计能力
 *
 * 安全约束：
 * - 只归档 applied_at IS NOT NULL 的事件
 * - 未应用事件绝不归档
 * - 小批量事务避免阻塞
 */

class QuotaEventsArchive {
  constructor(options = {}) {
    this.enabled = options.enabled !== false;
    this.retentionDays = options.retentionDays || 30; // 保留期（天）
    this.batchSize = options.batchSize || 500; // 单批次归档数量
    this.maxBatchesPerRun = options.maxBatchesPerRun || 10; // 单次运行最大批次数

    this.stats = {
      totalArchived: 0,
      totalDeleted: 0,
      lastRunAt: null,
      lastRunDuration: 0,
      lastRunBatches: 0,
      errors: 0
    };
  }

  /**
   * 执行归档任务
   * @returns {Object} 归档统计信息
   */
  async archive() {
    if (!this.enabled) {
      log.info('归档服务已禁用');
      return { archived: 0, deleted: 0, batches: 0 };
    }

    const startTime = Date.now();
    let totalArchived = 0;
    let totalDeleted = 0;
    let batchCount = 0;

    try {
      log.info({ retentionDays: this.retentionDays, batchSize: this.batchSize }, '开始归档任务');

      // 计算截止时间
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - this.retentionDays);
      const cutoffTimestamp = cutoffDate.toISOString();

      // 循环执行批量归档
      for (let i = 0; i < this.maxBatchesPerRun; i++) {
        const result = this._archiveBatch(cutoffTimestamp);

        if (result.archived === 0) {
          log.info('没有更多需要归档的事件');
          break;
        }

        totalArchived += result.archived;
        totalDeleted += result.deleted;
        batchCount++;

        log.info({
          batch: i + 1,
          archived: result.archived,
          deleted: result.deleted
        }, '批次归档完成');
      }

      const duration = Date.now() - startTime;

      // 更新统计信息
      this.stats.totalArchived += totalArchived;
      this.stats.totalDeleted += totalDeleted;
      this.stats.lastRunAt = new Date().toISOString();
      this.stats.lastRunDuration = duration;
      this.stats.lastRunBatches = batchCount;

      log.info({
        totalArchived,
        totalDeleted,
        batchCount,
        duration
      }, '归档任务完成');

      return {
        archived: totalArchived,
        deleted: totalDeleted,
        batches: batchCount,
        duration
      };

    } catch (error) {
      this.stats.errors++;
      log.error({ err: error }, '归档任务失败');
      throw error;
    }
  }

  /**
   * 执行单批次归档
   * @private
   * @param {string} cutoffTimestamp 截止时间戳
   * @returns {Object} { archived, deleted }
   */
  _archiveBatch(cutoffTimestamp) {
    const archiveBatch = sqlite.transaction(() => {
      // 1. 选择满足条件的历史事件
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

      // 2. 插入归档表
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

      // 3. 校验归档数量
      const archivedCount = sqlite.prepare(`
        SELECT COUNT(*) as count
        FROM storage_quota_events_archive
        WHERE id IN (${candidates.map(() => '?').join(',')})
      `).get(...candidates.map(e => e.id)).count;

      if (archivedCount !== candidates.length) {
        throw new Error(`归档数量不匹配: 预期 ${candidates.length}, 实际 ${archivedCount}`);
      }

      // 4. 从活跃表删除
      const deleteStmt = sqlite.prepare(`
        DELETE FROM storage_quota_events
        WHERE id IN (${candidates.map(() => '?').join(',')})
      `);

      const deleteResult = deleteStmt.run(...candidates.map(e => e.id));

      return {
        archived: archivedCount,
        deleted: deleteResult.changes
      };
    });

    return archiveBatch();
  }

  /**
   * 获取归档统计信息
   * @returns {Object} 统计信息
   */
  getStats() {
    // 获取活跃表和归档表的实时统计
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
      enabled: this.enabled
    };
  }

  /**
   * 清空归档表（仅用于测试或维护）
   * @returns {number} 删除的行数
   */
  clearArchive() {
    const result = sqlite.prepare('DELETE FROM storage_quota_events_archive').run();
    log.warn({ deleted: result.changes }, '归档表已清空');
    return result.changes;
  }
}

// 单例实例
let archiveInstance = null;

/**
 * 初始化归档服务
 * @param {Object} options 配置选项
 */
export function initQuotaEventsArchive(options = {}) {
  archiveInstance = new QuotaEventsArchive(options);
  log.info({
    enabled: archiveInstance.enabled,
    retentionDays: archiveInstance.retentionDays,
    batchSize: archiveInstance.batchSize
  }, '事件归档服务已初始化');
}

/**
 * 获取归档服务实例
 * @returns {QuotaEventsArchive}
 */
export function getQuotaEventsArchive() {
  if (!archiveInstance) {
    throw new Error('归档服务未初始化，请先调用 initQuotaEventsArchive()');
  }
  return archiveInstance;
}

export default QuotaEventsArchive;
