import config from './src/config/index.js';
import { initDb } from './src/database/index.js';
import { initResponseCache } from './src/services/cache/response-cache.js';
import { initQuotaEventsArchive } from './src/services/archive/quota-events-archive.js';
import { initArchiveScheduler } from './src/services/archive/archive-scheduler.js';

const port = config.server?.port || 13000;
const host = config.server?.host || '0.0.0.0';

const handleServerError = (error) => {
  if (error && error.code === 'EADDRINUSE') {
    console.error(`[服务端] 端口 ${port} 已被占用，请停止现有进程或修改配置后重试。`);
    process.exit(1);
  }

  console.error('[服务端] 启动失败:', error);
  process.exit(1);
};

process.on('uncaughtException', handleServerError);

// 在加载应用模块前初始化数据库，避免模块初始化阶段访问尚未建好的表
try {
  initDb();
} catch (error) {
  console.error('[服务端] 数据库初始化失败，应用终止启动:', error);
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

console.log(`[服务端] 正在启动服务，地址: http://${host === '0.0.0.0' ? 'localhost' : host}:${port}`);

const server = app.listen(Number(port), host, () => {
  const displayHost = host === '0.0.0.0' ? 'localhost' : host;
  console.log(`[服务端] 监听中，地址: http://${displayHost}:${port}`);
});

server.on('error', handleServerError);
