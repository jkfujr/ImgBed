import { createLogger } from '../../utils/logger.js';

const log = createLogger('storage-operations-cleanup');

/**
 * 删除已完成/已补偿的历史操作记录。
 *
 * @param {import('better-sqlite3').Database} db
 * @param {number} retainDays - 保留天数，默认 90 天
 * @returns {Promise<{deleted: number}>}
 */
export async function cleanupCompletedOperations(db, retainDays = 90) {
  const startTime = Date.now();
  const result = db.prepare(`
    DELETE FROM storage_operations
    WHERE status IN ('completed', 'compensated')
      AND updated_at < datetime('now', ?)
  `).run(`-${retainDays} days`);

  const duration = Date.now() - startTime;
  log.info({
    deleted: result.changes,
    retainDays,
    durationMs: duration
  }, 'storage_operations 清理完成');

  return { deleted: result.changes };
}
