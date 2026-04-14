import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

import { createApplicationRuntime } from '../../src/bootstrap/application-runtime.js';
import {
  createLoggerDouble,
  resolveProjectPath,
} from '../helpers/runtime-test-helpers.mjs';

test('main.js 通过 application-runtime 组装启动链', () => {
  const source = fs.readFileSync(resolveProjectPath('main.js'), 'utf8');

  assert.match(source, /createApplicationRuntime/);
  assert.match(source, /loadStartupConfig\(\)/);
  assert.match(source, /await runtime\.start\(\)/);
  assert.match(source, /registerSignalHandlers\(process\)/);
});

test('createApplicationRuntime.start 会按顺序执行启动依赖并启动 HTTP 服务', async () => {
  const calls = [];
  const loggerDouble = createLoggerDouble();

  const fakeServer = {
    on(eventName, handler) {
      calls.push(`server.on:${eventName}`);
      this.errorHandler = handler;
    },
    close(callback) {
      calls.push('server.close');
      callback();
    },
  };

  const fakeApp = {
    listen(port, host, callback) {
      calls.push(`app.listen:${host}:${port}`);
      callback();
      return fakeServer;
    },
  };

  const exitCodes = [];
  const runtime = createApplicationRuntime({
    config: {
      server: {
        host: '127.0.0.1',
        port: 18080,
      },
      storage: {
        storages: [{ id: 'local-1' }, { id: 'tg-1' }],
      },
      performance: {
        responseCache: {
          enabled: true,
          ttlSeconds: 30,
          maxKeys: 200,
        },
        quotaEventsArchive: {
          enabled: true,
          retentionDays: 7,
          batchSize: 100,
          maxBatchesPerRun: 2,
          scheduleHour: 4,
        },
      },
    },
    sqlite: {},
    initSchema: () => calls.push('initSchema'),
    runMigrations: () => calls.push('runMigrations'),
    freezeFilesByMissingStorageInstances: (_db, storageIds) => {
      calls.push(`freeze:${storageIds.join(',')}`);
      return { changes: 2 };
    },
    initResponseCache: (options) => calls.push(`initResponseCache:${JSON.stringify(options)}`),
    destroyResponseCache: () => calls.push('destroyResponseCache'),
    initQuotaEventsArchive: (options) => calls.push(`initQuotaEventsArchive:${JSON.stringify(options)}`),
    initArchiveScheduler: (options) => calls.push(`initArchiveScheduler:${JSON.stringify(options)}`),
    stopArchiveScheduler: () => calls.push('stopArchiveScheduler'),
    storageManager: {
      async initialize() {
        calls.push('storageManager.initialize');
      },
      async startMaintenance() {
        calls.push('storageManager.startMaintenance');
      },
      stopMaintenance() {
        calls.push('storageManager.stopMaintenance');
      },
    },
    loadApp: async () => {
      calls.push('loadApp');
      return fakeApp;
    },
    createLogger: () => loggerDouble.logger,
    flushLogs: async () => {
      calls.push('flushLogs');
    },
    setTimeoutFn: (handler, delayMs) => {
      calls.push(`setTimeout:${delayMs}`);
      return { handler, delayMs };
    },
    processExit: (code) => {
      exitCodes.push(code);
    },
  });

  await runtime.start();
  await runtime.shutdown('SIGTERM');

  assert.deepEqual(calls, [
    'initSchema',
    'runMigrations',
    'freeze:local-1,tg-1',
    'initResponseCache:{"enabled":true,"ttlSeconds":30,"maxKeys":200}',
    'initQuotaEventsArchive:{"enabled":true,"retentionDays":7,"batchSize":100,"maxBatchesPerRun":2}',
    'initArchiveScheduler:{"enabled":true,"scheduleHour":4}',
    'storageManager.initialize',
    'storageManager.startMaintenance',
    'loadApp',
    'app.listen:127.0.0.1:18080',
    'server.on:error',
    'storageManager.stopMaintenance',
    'stopArchiveScheduler',
    'destroyResponseCache',
    'server.close',
    'flushLogs',
    'setTimeout:10000',
  ]);
  assert.deepEqual(exitCodes, [0]);
});

test('registerSignalHandlers 会为 SIGTERM 和 SIGINT 注册优雅关闭入口', () => {
  const registeredSignals = [];
  const runtime = createApplicationRuntime({
    config: { server: { port: 13000 } },
    sqlite: {},
    initSchema: () => {},
    runMigrations: () => {},
    initResponseCache: () => {},
    destroyResponseCache: () => {},
    initQuotaEventsArchive: () => {},
    initArchiveScheduler: () => {},
    stopArchiveScheduler: () => {},
    storageManager: {
      async initialize() {},
      async startMaintenance() {},
      stopMaintenance() {},
    },
    loadApp: async () => ({
      listen() {
        return {
          on() {},
          close() {},
        };
      },
    }),
    createLogger: () => createLoggerDouble().logger,
    flushLogs: async () => {},
  });

  runtime.registerSignalHandlers({
    on(signal) {
      registeredSignals.push(signal);
    },
  });

  assert.deepEqual(registeredSignals, ['SIGTERM', 'SIGINT']);
});

test('handleServerError 在端口冲突时会直接退出', () => {
  const exitCodes = [];
  const runtime = createApplicationRuntime({
    config: { server: { port: 13000 } },
    sqlite: {},
    initSchema: () => {},
    runMigrations: () => {},
    initResponseCache: () => {},
    destroyResponseCache: () => {},
    initQuotaEventsArchive: () => {},
    initArchiveScheduler: () => {},
    stopArchiveScheduler: () => {},
    storageManager: {
      async initialize() {},
      async startMaintenance() {},
      stopMaintenance() {},
    },
    loadApp: async () => ({
      listen() {
        return {
          on() {},
          close() {},
        };
      },
    }),
    createLogger: () => createLoggerDouble().logger,
    flushLogs: async () => {},
    processExit: (code) => {
      exitCodes.push(code);
    },
  });

  runtime.handleServerError({ code: 'EADDRINUSE' });

  assert.deepEqual(exitCodes, [1]);
});
