import { strict as assert } from 'node:assert';

import { createApplicationRuntime } from '../ImgBed/src/bootstrap/application-runtime.js';

function makeLogger() {
  return {
    info() {},
    warn() {},
    error() {},
    fatal() {},
  };
}

async function testRuntimeStartUsesExplicitLifecycleOrder() {
  const events = [];
  let capturedServerErrorHandler = null;

  const fakeServer = {
    on(event, handler) {
      if (event === 'error') {
        capturedServerErrorHandler = handler;
      }
    },
    close() {},
  };

  const runtime = createApplicationRuntime({
    config: {
      server: { port: 14000, host: '127.0.0.1' },
      performance: {
        responseCache: { enabled: true, ttlSeconds: 90, maxKeys: 10 },
        quotaEventsArchive: { enabled: true, retentionDays: 7, batchSize: 20, maxBatchesPerRun: 2, scheduleHour: 4 },
      },
    },
    sqlite: { name: 'db' },
    dbPath: '/tmp/test.sqlite',
    initSchema() { events.push('initSchema'); },
    runMigrations() { events.push('runMigrations'); },
    syncAllStorageChannels: async () => { events.push('syncAllStorageChannels'); },
    initResponseCache() { events.push('initResponseCache'); },
    initQuotaEventsArchive() { events.push('initQuotaEventsArchive'); },
    initArchiveScheduler() { events.push('initArchiveScheduler'); },
    stopArchiveScheduler() {},
    storageManager: {
      async initialize() { events.push('storage.initialize'); },
      async startMaintenance() { events.push('storage.startMaintenance'); },
      stopMaintenance() {},
    },
    loadApp: async () => ({
      listen(port, host, callback) {
        events.push(`listen:${port}:${host}`);
        callback();
        return fakeServer;
      },
    }),
    createLogger: () => makeLogger(),
    flushLogs: async () => {},
    setTimeoutFn() {
      throw new Error('shutdown timer should not be created during start');
    },
    processExit() {
      throw new Error('processExit should not be called during start');
    },
  });

  const { server } = await runtime.start();

  assert.equal(server, fakeServer);
  assert.equal(typeof capturedServerErrorHandler, 'function');
  assert.deepEqual(events, [
    'initSchema',
    'runMigrations',
    'syncAllStorageChannels',
    'initResponseCache',
    'initQuotaEventsArchive',
    'initArchiveScheduler',
    'storage.initialize',
    'storage.startMaintenance',
    'listen:14000:127.0.0.1',
  ]);
  console.log('  [OK] main lifecycle: start uses explicit init order before listening');
}

async function testRuntimeShutdownStopsSchedulersAndFlushesLogs() {
  const events = [];
  let timeoutMs = null;
  let closeHandler = null;

  const runtime = createApplicationRuntime({
    config: {
      server: { port: 14001, host: '0.0.0.0' },
      performance: {
        responseCache: {},
        quotaEventsArchive: {},
      },
    },
    sqlite: {},
    dbPath: '/tmp/test.sqlite',
    initSchema() {},
    runMigrations() {},
    syncAllStorageChannels: async () => {},
    initResponseCache() {},
    initQuotaEventsArchive() {},
    initArchiveScheduler() {},
    stopArchiveScheduler() {
      events.push('archive.stop');
    },
    storageManager: {
      async initialize() {},
      async startMaintenance() {},
      stopMaintenance() {
        events.push('storage.stopMaintenance');
      },
    },
    loadApp: async () => ({
      listen(_port, _host, callback) {
        callback();
        return {
          on() {},
          close(handler) {
            events.push('server.close');
            closeHandler = handler;
          },
        };
      },
    }),
    createLogger: () => makeLogger(),
    flushLogs: async () => {
      events.push('flushLogs');
    },
    setTimeoutFn(handler, ms) {
      timeoutMs = ms;
      events.push('setTimeout');
      return { handler, ms };
    },
    processExit(code) {
      events.push(`exit:${code}`);
    },
  });

  await runtime.start();
  const shutdownPromise = runtime.shutdown('SIGTERM');
  assert.equal(timeoutMs, 10000);
  assert.deepEqual(events, [
    'storage.stopMaintenance',
    'archive.stop',
    'server.close',
    'setTimeout',
  ]);

  await closeHandler();
  await shutdownPromise;
  assert.deepEqual(events, [
    'storage.stopMaintenance',
    'archive.stop',
    'server.close',
    'setTimeout',
    'flushLogs',
    'exit:0',
  ]);
  console.log('  [OK] main lifecycle: shutdown stops schedulers, flushes logs, and exits cleanly');
}

async function main() {
  console.log('running main lifecycle tests...');
  await testRuntimeStartUsesExplicitLifecycleOrder();
  await testRuntimeShutdownStopsSchedulersAndFlushesLogs();
  console.log('main lifecycle tests passed');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
