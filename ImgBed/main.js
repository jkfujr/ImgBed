import { createApplicationRuntime } from './src/bootstrap/application-runtime.js';
import { loadStartupConfig } from './src/config/index.js';
import { ConfigFileError } from './src/errors/AppError.js';
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

function logConfigStartupFailure(error) {
  if (error instanceof ConfigFileError) {
    log.fatal({
      kind: error.kind,
      configPath: error.configPath,
      backupPath: error.backupPath,
      err: error.cause || error,
    }, error.message);
    return;
  }

  log.fatal({ err: error }, '应用启动失败');
}

async function createRuntime() {
  const config = loadStartupConfig();
  const [
    databaseModule,
    migrateModule,
    schemaModule,
    archiveSchedulerModule,
    quotaArchiveModule,
    responseCacheModule,
    filesDaoModule,
    storageManagerModule,
  ] = await Promise.all([
    import('./src/database/index.js'),
    import('./src/database/migrate.js'),
    import('./src/database/schema.js'),
    import('./src/services/archive/archive-scheduler.js'),
    import('./src/services/archive/quota-events-archive.js'),
    import('./src/services/cache/response-cache.js'),
    import('./src/database/files-dao.js'),
    import('./src/storage/manager.js'),
  ]);

  return createApplicationRuntime({
    config,
    sqlite: databaseModule.sqlite,
    initSchema: schemaModule.initSchema,
    runMigrations: migrateModule.runMigrations,
    freezeFilesByMissingStorageInstances: filesDaoModule.freezeFilesByMissingStorageInstances,
    initResponseCache: responseCacheModule.initResponseCache,
    destroyResponseCache: responseCacheModule.destroyResponseCache,
    initQuotaEventsArchive: quotaArchiveModule.initQuotaEventsArchive,
    initArchiveScheduler: archiveSchedulerModule.initArchiveScheduler,
    stopArchiveScheduler: archiveSchedulerModule.stopArchiveScheduler,
    storageManager: storageManagerModule.default,
    loadApp: async () => {
      const { default: app } = await import('./src/app.js');
      return app;
    },
    createLogger,
    flushLogs,
  });
}

try {
  const runtime = await createRuntime();
  await runtime.start();
  runtime.registerSignalHandlers(process);
} catch (error) {
  logConfigStartupFailure(error);
  process.exit(1);
}
