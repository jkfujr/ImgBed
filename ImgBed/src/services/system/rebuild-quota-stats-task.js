const REBUILD_QUOTA_STATS_TASK_NAME = 'rebuild-quota-stats';

function createRebuildQuotaStatsTaskDefinition({
  storageManager,
} = {}) {
  return {
    name: REBUILD_QUOTA_STATS_TASK_NAME,
    async run() {
      return storageManager.rebuildQuotaStats();
    },
  };
}

export {
  REBUILD_QUOTA_STATS_TASK_NAME,
  createRebuildQuotaStatsTaskDefinition,
};
