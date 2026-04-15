import assert from 'node:assert/strict';
import test from 'node:test';

import { StorageMaintenanceScheduler } from '../../src/storage/runtime/storage-maintenance-scheduler.js';
import { UploadSelector } from '../../src/storage/runtime/upload-selector.js';
import {
  JSON_RESULT_TAG,
  parseJsonResult,
  runIsolatedModuleScript,
} from '../helpers/isolated-module-test-helpers.mjs';

function createTimerHarness() {
  const timeoutCalls = [];
  const intervalCalls = [];
  const clearedTimeouts = [];
  const clearedIntervals = [];

  const originalSetTimeout = global.setTimeout;
  const originalClearTimeout = global.clearTimeout;
  const originalSetInterval = global.setInterval;
  const originalClearInterval = global.clearInterval;

  global.setTimeout = (handler, delayMs) => {
    const timer = {
      handler,
      delayMs,
      unref() {},
    };
    timeoutCalls.push(timer);
    return timer;
  };

  global.clearTimeout = (timer) => {
    clearedTimeouts.push(timer);
  };

  global.setInterval = (handler, delayMs) => {
    const timer = {
      handler,
      delayMs,
      unref() {},
    };
    intervalCalls.push(timer);
    return timer;
  };

  global.clearInterval = (timer) => {
    clearedIntervals.push(timer);
  };

  return {
    timeoutCalls,
    intervalCalls,
    clearedTimeouts,
    clearedIntervals,
    restore() {
      global.setTimeout = originalSetTimeout;
      global.clearTimeout = originalClearTimeout;
      global.setInterval = originalSetInterval;
      global.clearInterval = originalClearInterval;
    },
  };
}

function createSilentLogger() {
  return {
    info() {},
    warn() {},
    error() {},
  };
}

test('StorageRegistry.reload 会按运行时配置装载启用渠道并跳过初始化失败项', () => {
  const execution = runIsolatedModuleScript(`
    import { loadStartupConfig, writeRuntimeConfig } from './src/config/index.js';
    import { StorageRegistry } from './src/storage/runtime/storage-registry.js';

    const startup = loadStartupConfig();
    writeRuntimeConfig({
      ...startup,
      storage: {
        ...startup.storage,
        default: 'local-1',
        storages: [
          {
            id: 'local-1',
            name: '本地渠道',
            type: 'local',
            enabled: true,
            allowUpload: true,
            weight: 3,
            config: { marker: 'local-driver' },
          },
          {
            id: 'external-1',
            name: '外链只读',
            type: 'external',
            enabled: true,
            allowUpload: false,
            config: { marker: 'external-driver' },
          },
          {
            id: 'bad-1',
            name: '失败渠道',
            type: 'telegram',
            enabled: true,
            allowUpload: true,
            config: { fail: true },
          },
          {
            id: 'disabled-1',
            name: '停用渠道',
            type: 'local',
            enabled: false,
            allowUpload: true,
            config: { marker: 'disabled-driver' },
          },
        ],
      },
    });

    const registry = new StorageRegistry();
    registry.createStorageInstance = async (type, instanceConfig) => {
      if (instanceConfig.fail) {
        throw new Error('init failed');
      }

      return {
        type,
        marker: instanceConfig.marker,
      };
    };

    await registry.reload();

    const localMeta = registry.getStorageMeta('local-1');
    const externalMeta = registry.getStorageMeta('external-1');

    console.log('${JSON_RESULT_TAG}' + JSON.stringify({
      defaultId: registry.getDefaultStorageId(),
      enabled: registry.listEnabledStorages(),
      localMeta: {
        type: localMeta.type,
        allowUpload: localMeta.allowUpload,
        weight: localMeta.weight,
        marker: localMeta.instance.marker,
      },
      externalMeta: {
        type: externalMeta.type,
        allowUpload: externalMeta.allowUpload,
      },
      missingBadStorage: registry.getStorage('bad-1') === null,
      missingDisabledStorage: registry.getStorage('disabled-1') === null,
    }));
  `, {
    appRootPrefix: 'imgbed-storage-runtime-',
  });

  assert.equal(execution.status, 0, execution.stderr || execution.stdout);

  const result = parseJsonResult(execution);
  assert.equal(result.defaultId, 'local-1');
  assert.deepEqual(result.enabled, [
    { id: 'local-1', type: 'local', allowUpload: true },
    { id: 'external-1', type: 'external', allowUpload: false },
  ]);
  assert.deepEqual(result.localMeta, {
    type: 'local',
    allowUpload: true,
    weight: 3,
    marker: 'local-driver',
  });
  assert.deepEqual(result.externalMeta, {
    type: 'external',
    allowUpload: false,
  });
  assert.equal(result.missingBadStorage, true);
  assert.equal(result.missingDisabledStorage, true);
});

test('UploadSelector 会按 byType + least-used 选择当前最轻的可上传渠道', () => {
  const selector = new UploadSelector({
    getConfig: () => ({
      loadBalanceStrategy: 'least-used',
      loadBalanceScope: 'byType',
      loadBalanceEnabledTypes: ['s3'],
    }),
    listStorageEntries: () => ([
      ['local-1', { type: 'local', weight: 1 }],
      ['s3-1', { type: 's3', weight: 1 }],
      ['s3-2', { type: 's3', weight: 1 }],
    ]),
    canUpload: (storageId) => storageId !== 'local-1',
    getUsageStats: () => new Map([
      ['s3-1', { fileCount: 9, uploadCount: 0 }],
      ['s3-2', { fileCount: 2, uploadCount: 0 }],
    ]),
  });

  const selected = selector.selectUploadChannel('s3');

  assert.equal(selected, 's3-2');
});

test('UploadSelector 的 weighted 策略会优先使用显式权重配置', () => {
  const selector = new UploadSelector({
    random: () => 0.95,
    getConfig: () => ({
      loadBalanceStrategy: 'weighted',
      loadBalanceWeights: {
        'a-1': 1,
        'b-1': 9,
      },
    }),
    listStorageEntries: () => ([
      ['a-1', { type: 'local', weight: 1 }],
      ['b-1', { type: 'local', weight: 1 }],
    ]),
    canUpload: () => true,
  });

  const selected = selector.selectUploadChannel();

  assert.equal(selected, 'b-1');
});

test('StorageMaintenanceScheduler 会在恢复无进展时扩大补偿重试退避', { concurrency: false }, async (t) => {
  const timerHarness = createTimerHarness();
  t.after(() => timerHarness.restore());

  let recoveryCalls = 0;
  const scheduler = new StorageMaintenanceScheduler({
    logger: createSilentLogger(),
    db: {
      prepare() {
        return {
          get() {
            return { count: 1 };
          },
        };
      },
    },
    recoverPendingOperations: async () => {
      recoveryCalls += 1;
      return {
        recovered: 0,
        total: 1,
        skipped: false,
      };
    },
  });

  scheduler.startCompensationRetryTimer();
  assert.equal(timerHarness.timeoutCalls.length, 1);
  assert.equal(timerHarness.timeoutCalls[0].delayMs, 5 * 60 * 1000);

  await timerHarness.timeoutCalls[0].handler();

  assert.equal(recoveryCalls, 1);
  assert.equal(scheduler.compensationBackoffMs, 10 * 60 * 1000);
  assert.equal(timerHarness.timeoutCalls.length, 2);
  assert.equal(timerHarness.timeoutCalls[1].delayMs, 10 * 60 * 1000);

  scheduler.stopCompensationRetryTimer();
  assert.equal(scheduler.compensationRetryTimer, null);
});

test('StorageMaintenanceScheduler.refresh 只在已启动时重建容量并按新配置重挂定时器', { concurrency: false }, async (t) => {
  const timerHarness = createTimerHarness();
  t.after(() => timerHarness.restore());

  const rebuildCalls = [];
  const scheduler = new StorageMaintenanceScheduler({
    logger: createSilentLogger(),
    getUploadConfig: () => ({
      fullCheckIntervalHours: 2,
    }),
    rebuildQuotaStats: async () => {
      rebuildCalls.push('rebuild');
    },
  });

  await scheduler.refresh();
  assert.deepEqual(rebuildCalls, []);

  scheduler.started = true;
  await scheduler.refresh();

  assert.deepEqual(rebuildCalls, ['rebuild']);
  assert.equal(timerHarness.intervalCalls.length, 1);
  assert.equal(timerHarness.intervalCalls[0].delayMs, 2 * 60 * 60 * 1000);

  scheduler.stopFullRebuildTimer();
  assert.equal(scheduler.fullRebuildTimer, null);
  assert.equal(timerHarness.clearedIntervals.length, 1);
});
