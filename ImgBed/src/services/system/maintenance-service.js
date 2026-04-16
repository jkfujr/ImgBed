import { createLogger } from '../../utils/logger.js';
import { defaultMaintenanceTaskExecutor } from '../maintenance/default-maintenance-task-executor.js';
import {
  createRebuildQuotaStatsTaskDefinition,
  REBUILD_QUOTA_STATS_TASK_NAME,
} from './rebuild-quota-stats-task.js';

function createMaintenanceService({
  db,
  storageManager,
  logger = createLogger('system'),
  taskExecutor = defaultMaintenanceTaskExecutor,
  rebuildQuotaStatsTaskDefinition = null,
} = {}) {
  const taskDefinition = rebuildQuotaStatsTaskDefinition || createRebuildQuotaStatsTaskDefinition({
    storageManager,
  });

  taskExecutor.registerTask(taskDefinition);

  return {
    triggerQuotaStatsRebuild() {
      logger.info?.('手动触发容量校正任务');
      taskExecutor.start(REBUILD_QUOTA_STATS_TASK_NAME);

      return { status: 'processing' };
    },

    getQuotaHistory({ limit: limitInput, storageId }) {
      const limit = Math.min(parseInt(limitInput || '10'), 100);

      let query = 'SELECT * FROM storage_quota_history';
      const params = [];

      if (storageId) {
        query += ' WHERE storage_id = ?';
        params.push(storageId);
      }

      query += ' ORDER BY recorded_at DESC LIMIT ?';
      params.push(limit);

      return {
        history: db.prepare(query).all(...params),
      };
    },
  };
}

export { createMaintenanceService };
