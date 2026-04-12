import { createLogger } from '../../utils/logger.js';

const log = createLogger('storage');

class StorageMaintenanceScheduler {
  constructor({
    db,
    logger = log,
    getUploadConfig = () => ({}),
    verifyQuotaConsistency = async () => ({ consistent: true, inconsistencies: [] }),
    rebuildQuotaStats = async () => {},
    recoverPendingOperations = async () => ({ recovered: 0, total: 0, skipped: false }),
  } = {}) {
    this.db = db;
    this.log = logger;
    this.getUploadConfig = getUploadConfig;
    this.verifyQuotaConsistency = verifyQuotaConsistency;
    this.rebuildQuotaStats = rebuildQuotaStats;
    this.recoverPendingOperations = recoverPendingOperations;
    this.fullRebuildTimer = null;
    this.compensationRetryTimer = null;
    this.compensationBackoffMs = 5 * 60 * 1000;
    this.started = false;
  }

  async start() {
    if (this.started) {
      return;
    }

    this.startFullRebuildTimer();
    this.startCompensationRetryTimer();
    this.started = true;
  }

  stop() {
    this.stopFullRebuildTimer();
    this.stopCompensationRetryTimer();
    this.started = false;
  }

  async refresh() {
    if (!this.started) {
      return;
    }

    await this.rebuildQuotaStats().catch(() => {});
    this.stopFullRebuildTimer();
    this.startFullRebuildTimer();
  }

  startCompensationRetryTimer() {
    const db = this.db;
    const MIN_INTERVAL_MS = 5 * 60 * 1000;
    const MAX_INTERVAL_MS = 60 * 60 * 1000;

    if (this.compensationRetryTimer) {
      return;
    }

    const scheduleNext = () => {
      this.compensationRetryTimer = setTimeout(async () => {
        try {
          const pending = db.prepare(`
            SELECT COUNT(*) AS count FROM storage_operations
            WHERE status IN ('remote_done', 'committed', 'compensation_pending')
          `).get();

          if (pending.count > 0) {
            this.log.info(
              { count: pending.count, nextIntervalMs: this.compensationBackoffMs },
              '定时补偿重试发现待处理存储操作'
            );
            const result = await this.recoverPendingOperations();
            if (result.recovered > 0) {
              this.compensationBackoffMs = MIN_INTERVAL_MS;
            } else {
              this.compensationBackoffMs = Math.min(
                this.compensationBackoffMs * 2,
                MAX_INTERVAL_MS
              );
            }
          } else {
            this.compensationBackoffMs = MIN_INTERVAL_MS;
          }
        } catch (err) {
          this.log.error({ err }, '定时补偿重试执行失败');
          this.compensationBackoffMs = Math.min(
            this.compensationBackoffMs * 2,
            MAX_INTERVAL_MS
          );
        } finally {
          if (this.compensationRetryTimer !== null) {
            scheduleNext();
          }
        }
      }, this.compensationBackoffMs);

      this.compensationRetryTimer.unref();
    };

    scheduleNext();
  }

  stopCompensationRetryTimer() {
    if (this.compensationRetryTimer) {
      clearTimeout(this.compensationRetryTimer);
      this.compensationRetryTimer = null;
    }
  }

  startFullRebuildTimer() {
    const intervalHours = this.getUploadConfig()?.fullCheckIntervalHours || 6;
    const intervalMs = intervalHours * 60 * 60 * 1000;

    this.fullRebuildTimer = setInterval(async () => {
      try {
        this.log.info('定时容量一致性校验开始');
        const result = await this.verifyQuotaConsistency();

        if (!result.consistent) {
          this.log.warn(
            { count: result.inconsistencies.length },
            '检测到容量投影漂移，开始重建'
          );
          await this.rebuildQuotaStats();
        }
      } catch (err) {
        this.log.error({ err }, '定时容量维护失败');
      }
    }, intervalMs);

    this.fullRebuildTimer.unref();
  }

  stopFullRebuildTimer() {
    if (this.fullRebuildTimer) {
      clearInterval(this.fullRebuildTimer);
      this.fullRebuildTimer = null;
    }
  }
}

export { StorageMaintenanceScheduler };
