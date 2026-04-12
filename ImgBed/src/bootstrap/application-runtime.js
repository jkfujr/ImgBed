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
      log.fatal({ port, err: error }, `端口 ${port} 已被占用`);
      processExit(1);
      return;
    }

    log.fatal({ err: error }, '应用启动失败');
    processExit(1);
  };

  async function start() {
    initSchema(sqlite);
    runMigrations(sqlite, dbPath);
    await syncAllStorageChannels(config, sqlite);
    log.info('存储渠道已同步到数据库');

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
    log.info({ host, port }, `正在启动服务，地址: http://${displayHost}:${port}`);

    server = app.listen(Number(port), host, () => {
      log.info({ host, port }, `服务已启动，监听地址: http://${displayHost}:${port}`);
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
      log.info({ signal }, `收到 ${signal} 信号，开始优雅关闭`);

      storageManager.stopMaintenance();
      stopArchiveScheduler();

      server.close(async () => {
        log.info('HTTP 服务已关闭');
        await flushLogs();
        log.info('日志已刷新，进程即将退出');
        processExit(0);
        resolve();
      });

      setTimeoutFn(() => {
        log.error('优雅关闭超时，强制退出');
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
