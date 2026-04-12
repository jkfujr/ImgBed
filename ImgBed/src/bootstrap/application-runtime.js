export function createApplicationRuntime({
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
  loadApp,
  createLogger,
  flushLogs,
  setTimeoutFn = setTimeout,
  processExit = (code) => process.exit(code),
} = {}) {
  const log = createLogger('main');
  const port = config.server?.port || 13000;
  const host = config.server?.host || '0.0.0.0';
  const displayHost = host === '0.0.0.0' ? 'localhost' : host;
  const cacheConfig = config.performance?.responseCache || {};
  const archiveConfig = config.performance?.quotaEventsArchive || {};

  let server = null;
  let shutdownPromise = null;

  const handleServerError = (error) => {
    if (error && error.code === 'EADDRINUSE') {
      log.fatal({ port, err: error }, `Port ${port} is already in use`);
      processExit(1);
      return;
    }

    log.fatal({ err: error }, 'Application startup failed');
    processExit(1);
  };

  async function start() {
    initSchema(sqlite);
    runMigrations(sqlite, dbPath);
    await syncAllStorageChannels(config, sqlite);
    log.info('Storage channels synced to database');

    initResponseCache({
      enabled: cacheConfig.enabled !== false,
      ttlSeconds: cacheConfig.ttlSeconds || 60,
      maxKeys: cacheConfig.maxKeys || 1000,
    });

    initQuotaEventsArchive({
      enabled: archiveConfig.enabled !== false,
      retentionDays: archiveConfig.retentionDays || 30,
      batchSize: archiveConfig.batchSize || 500,
      maxBatchesPerRun: archiveConfig.maxBatchesPerRun || 10,
    });

    initArchiveScheduler({
      enabled: archiveConfig.enabled !== false,
      scheduleHour: archiveConfig.scheduleHour || 3,
    });

    await storageManager.initialize();
    await storageManager.startMaintenance();

    const app = await loadApp();
    log.info({ host, port }, `Starting server at http://${displayHost}:${port}`);

    server = app.listen(Number(port), host, () => {
      log.info({ host, port }, `Server listening at http://${displayHost}:${port}`);
    });
    server.on?.('error', handleServerError);

    return { server, shutdown };
  }

  async function shutdown(signal) {
    if (!server) {
      return;
    }

    if (shutdownPromise) {
      return shutdownPromise;
    }

    shutdownPromise = new Promise((resolve) => {
      log.info({ signal }, `Received ${signal}, shutting down`);

      storageManager.stopMaintenance();
      stopArchiveScheduler();

      server.close(async () => {
        log.info('HTTP server closed');
        await flushLogs();
        log.info('Logs flushed, exiting process');
        processExit(0);
        resolve();
      });

      setTimeoutFn(() => {
        log.error('Graceful shutdown timed out, forcing exit');
        processExit(1);
      }, 10000);
    });

    return shutdownPromise;
  }

  function registerSignalHandlers(processLike = process) {
    processLike.on('SIGTERM', () => shutdown('SIGTERM'));
    processLike.on('SIGINT', () => shutdown('SIGINT'));
  }

  return {
    start,
    shutdown,
    registerSignalHandlers,
    handleServerError,
  };
}
