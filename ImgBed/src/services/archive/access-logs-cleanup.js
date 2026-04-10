import { createLogger } from '../../utils/logger.js';

const log = createLogger('access-logs-cleanup');

/**
 * 删除超出保留天数的访问日志。
 *
 * @param {import('better-sqlite3').Database} db
 * @param {number} retainDays - 保留天数，默认 30 天
 * @returns {Promise<{deleted: number}>}
 */
export async function cleanupOldAccessLogs(db, retainDays = 30) {
  const startTime = Date.now();
  const result = db.prepare(`
    DELETE FROM access_logs
    WHERE created_at < datetime('now', ?)
  `).run(`-${retainDays} days`);

  const duration = Date.now() - startTime;
  log.info({
    deleted: result.changes,
    retainDays,
    durationMs: duration
  }, '访问日志清理完成');

  return { deleted: result.changes };
}
