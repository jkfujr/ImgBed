import { ValidationError } from '../../errors/AppError.js';
import { buildLocalDayUtcRangeCondition } from '../../database/sqlite-time.js';

function createDashboardService({
  db,
  readRuntimeConfig,
  getActiveFilesStats,
  getTodayUploadCount,
  getUploadTrend,
  summarizeStorages,
} = {}) {
  return {
    getOverview() {
      const { count: totalFiles, sum: totalSize } = getActiveFilesStats(db);
      const todayUploads = getTodayUploadCount(db);
      const config = readRuntimeConfig();
      const storageSummary = summarizeStorages(config.storage?.storages || []);
      const todayAccessCondition = buildLocalDayUtcRangeCondition('created_at');

      const todayAccessResult = db.prepare(`
        SELECT COUNT(*) as count FROM access_logs
        WHERE ${todayAccessCondition}
      `).get();

      return {
        totalFiles,
        totalSize,
        todayUploads,
        todayAccess: todayAccessResult?.count || 0,
        totalChannels: storageSummary.total,
        enabledChannels: storageSummary.enabled,
      };
    },

    getUploadTrend(daysInput) {
      const days = parseInt(daysInput) || 7;

      if (![7, 30, 90].includes(days)) {
        throw new ValidationError('days 参数必须是 7、30 或 90');
      }

      return {
        trend: getUploadTrend(db, days),
      };
    },

    getAccessStats() {
      const todayAccessCondition = buildLocalDayUtcRangeCondition('created_at');
      const sevenDayAccessCondition = buildLocalDayUtcRangeCondition('access_logs.created_at', {
        startDayOffset: -6,
        endDayOffset: 1,
      });

      // 合并查询：今日访问数和独立访客数
      const todayStats = db.prepare(`
        SELECT
          COUNT(*) as todayAccess,
          COUNT(DISTINCT ip) as todayVisitors
        FROM access_logs
        WHERE ${todayAccessCondition}
          AND is_admin = 0
      `).get();

      const topFiles = db.prepare(`
        SELECT
          access_logs.file_id as fileId,
          files.file_name as fileName,
          files.original_name as originalName,
          COUNT(access_logs.id) as accessCount
        FROM access_logs
        INNER JOIN files ON access_logs.file_id = files.id
        WHERE ${sevenDayAccessCondition}
          AND access_logs.is_admin = 0
          AND files.status = 'active'
        GROUP BY access_logs.file_id
        ORDER BY accessCount DESC
        LIMIT 5
      `).all();

      const accessTrend = db.prepare(`
        SELECT
          DATE(created_at, 'localtime') as date,
          COUNT(*) as accessCount
        FROM access_logs
        WHERE ${sevenDayAccessCondition}
          AND is_admin = 0
        GROUP BY DATE(created_at, 'localtime')
        ORDER BY date ASC
      `).all();

      return {
        todayAccess: todayStats?.todayAccess || 0,
        todayVisitors: todayStats?.todayVisitors || 0,
        topFiles,
        accessTrend,
      };
    },
  };
}

export { createDashboardService };
