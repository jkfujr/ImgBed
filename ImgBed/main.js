import { createApplicationRuntime } from './src/bootstrap/application-runtime.js';
import config from './src/config/index.js';
import { sqlite, dbPath } from './src/database/index.js';
import { runMigrations } from './src/database/migrate.js';
import { initSchema } from './src/database/schema.js';
import { initArchiveScheduler, stopArchiveScheduler } from './src/services/archive/archive-scheduler.js';
import { initQuotaEventsArchive } from './src/services/archive/quota-events-archive.js';
import { initResponseCache } from './src/services/cache/response-cache.js';
import { syncAllStorageChannels } from './src/services/system/storage-channel-sync.js';
import storageManager from './src/storage/manager.js';
import { createLogger, flushLogs } from './src/utils/logger.js';

const log = createLogger('main');

const RECOVERABLE_ERROR_PATTERNS = [
  'Checksum mismatch',
  'ECONNRESET',
  'ETIMEDOUT',
  'ENOTFOUND',
  'ECONNREFUSED',
  'socket hang up',
  'premature close',
  'aborted',
  'Client network socket disconnected',
  'write EPIPE',
  'read ECONNRESET',
];

const isRecoverableError = (error) => {
  const message = error?.message || '';
  const code = error?.code || '';
  return RECOVERABLE_ERROR_PATTERNS.some((pattern) => message.includes(pattern) || code.includes(pattern));
};

process.on('uncaughtException', (error) => {
  if (isRecoverableError(error)) {
    log.error({ err: error }, '已捕获可恢复的未捕获异常');
    return;
  }

  log.fatal({ err: error }, '发生致命未捕获异常');
  process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  const error = reason instanceof Error ? reason : new Error(String(reason));

  if (isRecoverableError(error)) {
    log.error({ reason, promise }, '已捕获可恢复的未处理 Promise 拒绝');
    return;
  }

  log.error({ reason, promise }, '出现未处理的 Promise 拒绝');
});

const runtime = createApplicationRuntime({
  config,
  sqlite,
  dbPath,
  initSchema,
  runMigrations,
  syncAllStorageChannels,
  initResponseCache,
  initQuotaEventsArchive,
  initArchiveScheduler,
  stopArchiveScheduler,
  storageManager,
  loadApp: async () => {
    const { default: app } = await import('./src/app.js');
    return app;
  },
  createLogger,
  flushLogs,
});

try {
  await runtime.start();
  runtime.registerSignalHandlers(process);
} catch (error) {
  log.fatal({ err: error }, '应用启动失败');
  process.exit(1);
}
