function createMaintenanceService({
  db,
  storageManager,
  logger,
} = {}) {
  return {
    triggerQuotaStatsRebuild() {
      void (async () => {
        try {
          logger.info('手动触发容量校正任务');
          await storageManager.rebuildQuotaStats();
          logger.info('容量校正任务完成');
        } catch (error) {
          logger.error({ err: error }, '容量校正任务失败');
        }
      })();

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
