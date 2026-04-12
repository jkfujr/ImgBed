import { sqlite } from '../../database/index.js';
import { createLogger } from '../../utils/logger.js';
import { cleanupOldAccessLogs } from './access-logs-cleanup.js';
import { getQuotaEventsArchive } from './quota-events-archive.js';
import { cleanupCompletedOperations } from './storage-operations-cleanup.js';

const log = createLogger('archive-scheduler');

class ArchiveScheduler {
  constructor(options = {}) {
    this.enabled = options.enabled !== false;
    this.scheduleHour = options.scheduleHour || 3;
    this.timer = null;
    this.isRunning = false;
  }

  start() {
    if (!this.enabled) {
      log.info('归档调度器已禁用');
      return;
    }

    if (this.timer) {
      log.warn('归档调度器已在运行');
      return;
    }

    log.info({ scheduleHour: this.scheduleHour }, '归档调度器已启动');
    this._scheduleNext();
  }

  stop() {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
      log.info('归档调度器已停止');
    }
  }

  async runNow() {
    if (this.isRunning) {
      log.warn('归档任务正在执行中，跳过本次触发');
      return { skipped: true };
    }

    return await this._executeArchive();
  }

  _scheduleNext() {
    const now = new Date();
    const nextRun = new Date();

    nextRun.setHours(this.scheduleHour, 0, 0, 0);
    if (nextRun <= now) {
      nextRun.setDate(nextRun.getDate() + 1);
    }

    const delay = nextRun.getTime() - now.getTime();

    log.info({
      nextRun: nextRun.toISOString(),
      delayMinutes: Math.round(delay / 60000),
    }, '下次归档任务已调度');

    this.timer = setTimeout(() => {
      this._executeArchive().finally(() => {
        this._scheduleNext();
      });
    }, delay);
  }

  async _executeArchive() {
    this.isRunning = true;

    try {
      log.info('开始执行定时归档任务');

      const archive = getQuotaEventsArchive();
      const result = await archive.archive();

      log.info({
        archived: result.archived,
        deleted: result.deleted,
        batches: result.batches,
        duration: result.duration,
      }, '定时归档任务完成');

      const accessLogsResult = await cleanupOldAccessLogs(sqlite, 30);
      log.info({ deleted: accessLogsResult.deleted }, '访问日志清理完成');

      const opsResult = await cleanupCompletedOperations(sqlite, 90);
      log.info({ deleted: opsResult.deleted }, '存储操作清理完成');

      return { ...result, accessLogsDeleted: accessLogsResult.deleted, opsDeleted: opsResult.deleted };
    } catch (error) {
      log.error({ err: error }, '定时归档任务失败');
      throw error;
    } finally {
      this.isRunning = false;
    }
  }

  getStatus() {
    return {
      enabled: this.enabled,
      isRunning: this.isRunning,
      scheduleHour: this.scheduleHour,
      hasTimer: this.timer !== null,
    };
  }
}

let schedulerInstance = null;

export function initArchiveScheduler(options = {}) {
  schedulerInstance = new ArchiveScheduler(options);
  schedulerInstance.start();
}

export function getArchiveScheduler() {
  if (!schedulerInstance) {
    throw new Error('归档调度器尚未初始化，请先调用 initArchiveScheduler()');
  }
  return schedulerInstance;
}

export function stopArchiveScheduler() {
  if (schedulerInstance) {
    schedulerInstance.stop();
    schedulerInstance = null;
  }
}

export default ArchiveScheduler;
