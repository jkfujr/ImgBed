import { createApplicationRuntime } from './src/bootstrap/application-runtime.js';
import { classifyEntryError } from './src/bootstrap/entry-error-policy.js';
import { loadStartupConfig } from './src/config/index.js';
import { ConfigFileError } from './src/errors/AppError.js';
import { createLogger, flushLogs } from './src/utils/logger.js';

const log = createLogger('main');

process.on('uncaughtException', (error) => {
  const classification = classifyEntryError(error, 'uncaughtException');

  if (classification.type === 'recoverable') {
    log.error({
      err: classification.error,
      category: classification.category,
      source: classification.source,
    }, classification.message);
    return;
  }

  log.fatal({ err: classification.error }, classification.message);
  process.exit(classification.exitCode || 1);
});

process.on('unhandledRejection', (reason, promise) => {
  const classification = classifyEntryError(reason, 'unhandledRejection');

  if (classification.type === 'recoverable') {
    log.error({
      reason,
      promise,
      category: classification.category,
      source: classification.source,
    }, classification.message);
    return;
  }

  log.error({ reason, promise }, classification.message);
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

  const classification = classifyEntryError(error, 'startup');
  log.fatal({ err: classification.error }, classification.message);
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
