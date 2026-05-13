import { sqlite } from '../../database/index.js';
import { createLogger } from '../../utils/logger.js';

const log = createLogger('access-log-buffer');

class AccessLogBuffer {
  constructor(options = {}) {
    this.enabled = options.enabled !== false;
    this.maxSize = options.maxSize || 100;
    this.flushInterval = options.flushInterval || 5000;
    this.buffer = [];
    this.timer = null;
    this.insertStmt = null;
    this.stats = {
      totalAdded: 0,
      totalFlushed: 0,
      flushCount: 0,
      errors: 0,
    };
  }

  add(logEntry) {
    if (!this.enabled) return;

    this.buffer.push({
      fileId: logEntry.fileId,
      ip: logEntry.ip,
      userAgent: logEntry.userAgent || null,
      referer: logEntry.referer || null,
      isAdmin: logEntry.isAdmin || 0,
    });
    this.stats.totalAdded++;

    if (this.buffer.length >= this.maxSize) {
      this.flush();
    }
  }

  flush() {
    if (this.buffer.length === 0) return;

    const items = this.buffer.splice(0);
    const count = items.length;

    try {
      const batchInsert = sqlite.transaction(() => {
        for (const item of items) {
          this.insertStmt.run(
            item.fileId,
            item.ip,
            item.userAgent,
            item.referer,
            item.isAdmin
          );
        }
      });

      batchInsert();

      this.stats.totalFlushed += count;
      this.stats.flushCount++;

      log.debug({ count }, '访问日志批量写入完成');
    } catch (error) {
      this.stats.errors++;
      log.error({ err: error, count }, '访问日志批量写入失败');
    }
  }

  start() {
    if (!this.enabled) {
      log.info('访问日志缓冲服务已禁用');
      return;
    }

    this.insertStmt = sqlite.prepare(
      'INSERT INTO access_logs (file_id, ip, user_agent, referer, is_admin) VALUES (?, ?, ?, ?, ?)'
    );

    this.timer = setInterval(() => this.flush(), this.flushInterval);
    this.timer.unref();

    log.info({
      maxSize: this.maxSize,
      flushInterval: this.flushInterval,
    }, '访问日志缓冲服务已启动');
  }

  stop() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }

    this.flush();

    log.info({
      totalAdded: this.stats.totalAdded,
      totalFlushed: this.stats.totalFlushed,
      flushCount: this.stats.flushCount,
    }, '访问日志缓冲服务已停止');
  }

  getStats() {
    return {
      ...this.stats,
      bufferSize: this.buffer.length,
      maxSize: this.maxSize,
      flushInterval: this.flushInterval,
      enabled: this.enabled,
    };
  }
}

let instance = null;

export function initAccessLogBuffer(options = {}) {
  if (instance) instance.stop();
  instance = new AccessLogBuffer(options);
  instance.start();
  return instance;
}

export function getAccessLogBuffer() {
  if (!instance) {
    throw new Error('访问日志缓冲服务尚未初始化，请先调用 initAccessLogBuffer()');
  }
  return instance;
}

export function stopAccessLogBuffer() {
  if (instance) {
    instance.stop();
    instance = null;
  }
}

export default AccessLogBuffer;
