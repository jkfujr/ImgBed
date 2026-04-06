import { getQuotaEventsArchive } from './quota-events-archive.js';
import { createLogger } from '../../utils/logger.js';

const log = createLogger('archive-scheduler');

/**
 * 归档调度器
 *
 * 职责：
 * 1. 按配置的时间定期执行归档任务
 * 2. 避免与业务高峰期冲突
 * 3. 记录执行日志
 */

class ArchiveScheduler {
  constructor(options = {}) {
    this.enabled = options.enabled !== false;
    this.scheduleHour = options.scheduleHour || 3; // 默认凌晨3点执行
    this.timer = null;
    this.isRunning = false;
  }

  /**
   * 启动调度器
   */
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

    // 计算下次执行时间
    this._scheduleNext();
  }

  /**
   * 停止调度器
   */
  stop() {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
      log.info('归档调度器已停止');
    }
  }

  /**
   * 立即执行归档任务（手动触发）
   */
  async runNow() {
    if (this.isRunning) {
      log.warn('归档任务正在执行中，跳过本次触发');
      return { skipped: true };
    }

    return await this._executeArchive();
  }

  /**
   * 计算并调度下次执行
   * @private
   */
  _scheduleNext() {
    const now = new Date();
    const nextRun = new Date();

    // 设置为今天的目标小时
    nextRun.setHours(this.scheduleHour, 0, 0, 0);

    // 如果今天的时间已过，则调度到明天
    if (nextRun <= now) {
      nextRun.setDate(nextRun.getDate() + 1);
    }

    const delay = nextRun.getTime() - now.getTime();

    log.info({
      nextRun: nextRun.toISOString(),
      delayMinutes: Math.round(delay / 60000)
    }, '下次归档任务已调度');

    this.timer = setTimeout(() => {
      this._executeArchive().finally(() => {
        // 执行完成后调度下一次
        this._scheduleNext();
      });
    }, delay);
  }

  /**
   * 执行归档任务
   * @private
   */
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
        duration: result.duration
      }, '定时归档任务完成');

      return result;

    } catch (error) {
      log.error({ err: error }, '定时归档任务失败');
      throw error;

    } finally {
      this.isRunning = false;
    }
  }

  /**
   * 获取调度器状态
   */
  getStatus() {
    return {
      enabled: this.enabled,
      isRunning: this.isRunning,
      scheduleHour: this.scheduleHour,
      hasTimer: this.timer !== null
    };
  }
}

// 单例实例
let schedulerInstance = null;

/**
 * 初始化归档调度器
 * @param {Object} options 配置选项
 */
export function initArchiveScheduler(options = {}) {
  schedulerInstance = new ArchiveScheduler(options);
  schedulerInstance.start();
}

/**
 * 获取归档调度器实例
 * @returns {ArchiveScheduler}
 */
export function getArchiveScheduler() {
  if (!schedulerInstance) {
    throw new Error('归档调度器未初始化，请先调用 initArchiveScheduler()');
  }
  return schedulerInstance;
}

/**
 * 停止归档调度器
 */
export function stopArchiveScheduler() {
  if (schedulerInstance) {
    schedulerInstance.stop();
    schedulerInstance = null;
  }
}

export default ArchiveScheduler;
