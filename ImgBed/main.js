import config from './src/config/index.js';
import { initDb } from './src/database/index.js';
import { initResponseCache } from './src/services/cache/response-cache.js';
import { initQuotaEventsArchive } from './src/services/archive/quota-events-archive.js';
import { initArchiveScheduler } from './src/services/archive/archive-scheduler.js';
import { createLogger, flushLogs } from './src/utils/logger.js';

const log = createLogger('main');

const port = config.server?.port || 13000;
const host = config.server?.host || '0.0.0.0';

const handleServerError = (error) => {
  if (error && error.code === 'EADDRINUSE') {
    log.fatal({ port, err: error }, `端口 ${port} 已被占用，请停止现有进程或修改配置后重试`);
    process.exit(1);
  }

  log.fatal({ err: error }, '服务启动失败');
  process.exit(1);
};

process.on('uncaughtException', handleServerError);

// 在加载应用模块前初始化数据库，避免模块初始化阶段访问尚未建好的表
try {
  initDb();
} catch (error) {
  log.fatal({ err: error }, '数据库初始化失败，应用终止启动');
  process.exit(1);
}

// 初始化响应缓存服务
const cacheConfig = config.performance?.responseCache || {};
initResponseCache({
  enabled: cacheConfig.enabled !== false,
  ttlSeconds: cacheConfig.ttlSeconds || 60,
  maxKeys: cacheConfig.maxKeys || 1000
});

// 初始化事件归档服务
const archiveConfig = config.performance?.quotaEventsArchive || {};
initQuotaEventsArchive({
  enabled: archiveConfig.enabled !== false,
  retentionDays: archiveConfig.retentionDays || 30,
  batchSize: archiveConfig.batchSize || 500,
  maxBatchesPerRun: archiveConfig.maxBatchesPerRun || 10
});

// 初始化归档调度器
initArchiveScheduler({
  enabled: archiveConfig.enabled !== false,
  scheduleHour: archiveConfig.scheduleHour || 3
});

const { default: app } = await import('./src/app.js');

const displayHost = host === '0.0.0.0' ? 'localhost' : host;
log.info({ host, port }, `正在启动服务，地址: http://${displayHost}:${port}`);

const server = app.listen(Number(port), host, () => {
  log.info({ host, port }, `服务已启动，监听地址: http://${displayHost}:${port}`);
});

server.on('error', handleServerError);

// 优雅关闭：确保日志缓冲区在进程退出前完全写入
const gracefulShutdown = async (signal) => {
  log.info({ signal }, `收到 ${signal} 信号，开始优雅关闭`);

  server.close(async () => {
    log.info('HTTP 服务已关闭');

    // 刷新日志缓冲区
    await flushLogs();
    log.info('日志已刷新，进程即将退出');

    process.exit(0);
  });

  // 超时强制退出
  setTimeout(() => {
    log.error('优雅关闭超时，强制退出');
    process.exit(1);
  }, 10000);
};

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));
