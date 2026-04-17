import assert from 'node:assert/strict';
import test from 'node:test';

import express from 'express';

import {
  createTempAppRoot,
  resolveProjectModuleUrl,
} from '../helpers/runtime-test-helpers.mjs';

const appRoot = createTempAppRoot('imgbed-03-system-router-');
process.env.IMGBED_APP_ROOT = appRoot;

const configModule = await import(resolveProjectModuleUrl('src', 'config', 'index.js'));
configModule.loadStartupConfig();

const { ConflictError, ValidationError } = await import(resolveProjectModuleUrl('src', 'errors', 'AppError.js'));
const { notFoundHandler, registerErrorHandlers } = await import(resolveProjectModuleUrl('src', 'middleware', 'errorHandler.js'));
const { createSystemRouter } = await import(resolveProjectModuleUrl('src', 'routes', 'system.js'));
const { createSystemConfigRouter } = await import(resolveProjectModuleUrl('src', 'routes', 'system', 'config-router.js'));
const { createSystemStoragesRouter } = await import(resolveProjectModuleUrl('src', 'routes', 'system', 'storages-router.js'));
const { createSystemMaintenanceRouter } = await import(resolveProjectModuleUrl('src', 'routes', 'system', 'maintenance-router.js'));
const { createSystemRuntimeRouter } = await import(resolveProjectModuleUrl('src', 'routes', 'system', 'runtime-router.js'));
const { createSystemDashboardRouter } = await import(resolveProjectModuleUrl('src', 'routes', 'system', 'dashboard-router.js'));

function createPassthroughCache() {
  return () => (_req, _res, next) => next();
}

async function startRouterApp(router) {
  const app = express();
  app.use(express.json());
  app.use(router);
  app.use(notFoundHandler);
  registerErrorHandlers(app);

  const server = await new Promise((resolve) => {
    const instance = app.listen(0, '127.0.0.1', () => resolve(instance));
  });

  const { port } = server.address();
  return {
    baseUrl: `http://127.0.0.1:${port}`,
    async stop() {
      await new Promise((resolve) => server.close(resolve));
    },
  };
}

async function requestJson(appHandle, path, options = {}) {
  const headers = {
    ...(options.headers || {}),
  };
  let body = options.body;

  if (options.json !== undefined) {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(options.json);
  }

  const response = await fetch(appHandle.baseUrl + path, {
    method: options.method || 'GET',
    headers,
    body,
  });
  const text = await response.text();

  return {
    status: response.status,
    body: text ? JSON.parse(text) : null,
  };
}

test('createSystemRouter 会使用注入依赖完成装配，而不是直接依赖全局运行时单例', async (t) => {
  const authCalls = [];
  const passthroughCache = createPassthroughCache();
  const appHandle = await startRouterApp(createSystemRouter({
    adminAuth(req, _res, next) {
      authCalls.push(req.path);
      next();
    },
    systemConfigCache: passthroughCache,
    storagesListCache: passthroughCache,
    storagesStatsCache: passthroughCache,
    quotaStatsCache: passthroughCache,
    loadBalanceCache: passthroughCache,
    dashboardOverviewCache: passthroughCache,
    dashboardUploadTrendCache: passthroughCache,
    dashboardAccessStatsCache: passthroughCache,
    readRuntimeConfig: () => ({
      admin: { username: 'admin' },
      storage: {
        default: 's3-1',
        storages: [
          { id: 's3-1', type: 's3', name: '主渠道', enabled: true, allowUpload: true, config: { secretAccessKey: 'secret' } },
        ],
      },
    }),
    sanitizeSystemConfig: (config) => ({
      ...config,
      masked: true,
    }),
    sanitizeStorageChannel: (storage) => ({
      ...storage,
      config: { ...storage.config, secretAccessKey: '***' },
    }),
    summarizeStorages: () => ({ total: 1, enabled: 1, allowUpload: 1, byType: { s3: 1 } }),
    storageManager: {
      getAllQuotaStats() {
        return { 's3-1': 42 };
      },
      getUsageStats() {
        return { 's3-1': { fileCount: 1 } };
      },
    },
    systemConfigService: {
      updateConfig() {},
    },
    storageConfigService: {
      async testStorageConnection() {
        return { ok: true };
      },
      async updateLoadBalance() {},
      async createStorage() {
        return { id: 'new-storage', type: 'local', config: {} };
      },
      async updateStorage() {
        return { id: 's3-1', type: 's3', config: {} };
      },
      async deleteStorage() {},
      async setDefaultStorage() {},
      async toggleStorage() {
        return true;
      },
    },
    maintenanceService: {
      triggerQuotaStatsRebuild() {
        return { status: 'processing' };
      },
      getQuotaHistory() {
        return { history: [{ id: 'hist-1' }] };
      },
    },
    getResponseCache: () => ({
      getStats() {
        return { hits: 2 };
      },
    }),
    invalidateAllCaches() {},
    getQuotaEventsArchive: () => ({
      getStats() {
        return { archivedEvents: 3 };
      },
    }),
    getArchiveScheduler: () => ({
      async runNow() {
        return { archived: 0, deleted: 0, batches: 0, duration: 1 };
      },
      getStatus() {
        return { enabled: false, hasTimer: false };
      },
    }),
    dashboardService: {
      getOverview() {
        return { totalFiles: 1 };
      },
      getUploadTrend() {
        return { trend: [] };
      },
      getAccessStats() {
        return { todayAccess: 0 };
      },
    },
  }));
  t.after(() => appHandle.stop());

  const configResponse = await requestJson(appHandle, '/config');
  const storagesResponse = await requestJson(appHandle, '/storages');
  const cacheResponse = await requestJson(appHandle, '/cache/stats');
  const archiveResponse = await requestJson(appHandle, '/archive/stats');
  const schedulerResponse = await requestJson(appHandle, '/archive/scheduler');
  const dashboardResponse = await requestJson(appHandle, '/dashboard/overview');

  assert.equal(configResponse.status, 200);
  assert.equal(configResponse.body.data.masked, true);
  assert.equal(storagesResponse.status, 200);
  assert.equal(storagesResponse.body.data.list[0].config.secretAccessKey, '***');
  assert.equal(cacheResponse.body.data.hits, 2);
  assert.equal(archiveResponse.body.data.archivedEvents, 3);
  assert.equal(schedulerResponse.body.data.enabled, false);
  assert.equal(dashboardResponse.body.data.totalFiles, 1);
  assert.equal(authCalls.length, 6);
});

test('createSystemConfigRouter 会保持 GET 脱敏与 PUT 成功响应契约', async (t) => {
  const passthroughCache = createPassthroughCache();
  const updateCalls = [];
  const appHandle = await startRouterApp(createSystemConfigRouter({
    systemConfigCache: passthroughCache,
    readRuntimeConfig: () => ({
      jwt: { secret: 'secret' },
    }),
    sanitizeSystemConfig: (config) => ({
      ...config,
      jwt: { secret: '******' },
    }),
    systemConfigService: {
      updateConfig(body) {
        updateCalls.push(body);
      },
    },
  }));
  t.after(() => appHandle.stop());

  const getResponse = await requestJson(appHandle, '/config');
  const putResponse = await requestJson(appHandle, '/config', {
    method: 'PUT',
    json: {
      server: { port: 15000 },
    },
  });

  assert.equal(getResponse.status, 200);
  assert.equal(getResponse.body.data.jwt.secret, '******');
  assert.equal(putResponse.status, 200);
  assert.equal(putResponse.body.message, '配置已保存，部分配置需重启服务后生效');
  assert.deepEqual(updateCalls, [{
    server: { port: 15000 },
  }]);
});

test('createSystemStoragesRouter 会输出掩码后的渠道列表并复用注入服务处理变更', async (t) => {
  const passthroughCache = createPassthroughCache();
  const serviceCalls = [];
  const appHandle = await startRouterApp(createSystemStoragesRouter({
    storagesListCache: passthroughCache,
    storagesStatsCache: passthroughCache,
    loadBalanceCache: passthroughCache,
    quotaStatsCache: passthroughCache,
    readRuntimeConfig: () => ({
      storage: {
        default: 's3-1',
        loadBalanceStrategy: 'weighted',
        loadBalanceScope: 'byType',
        loadBalanceEnabledTypes: ['s3'],
        loadBalanceWeights: { 's3-1': 9 },
        failoverEnabled: true,
        storages: [
          { id: 's3-1', type: 's3', name: '主渠道', enabled: true, allowUpload: true, config: { secretAccessKey: 'secret' } },
        ],
      },
    }),
    sanitizeStorageChannel: (storage) => ({
      ...storage,
      config: { ...storage.config, secretAccessKey: '***' },
    }),
    summarizeStorages: () => ({ total: 1, enabled: 1, allowUpload: 1, byType: { s3: 1 } }),
    storageManager: {
      getAllQuotaStats() {
        return { 's3-1': 64 };
      },
      getUsageStats() {
        return { 's3-1': { fileCount: 2 } };
      },
    },
    storageConfigService: {
      async testStorageConnection(type, config) {
        serviceCalls.push({ type, config });
        return { ok: true };
      },
      async updateLoadBalance(body) {
        serviceCalls.push({ updateLoadBalance: body });
      },
      async createStorage(body) {
        serviceCalls.push({ createStorage: body });
        return { id: 'local-1', type: 'local', config: {} };
      },
      async updateStorage() {
        return { id: 's3-1', type: 's3', config: {} };
      },
      async deleteStorage() {},
      async setDefaultStorage() {},
      async toggleStorage() {
        return true;
      },
    },
  }));
  t.after(() => appHandle.stop());

  const storagesResponse = await requestJson(appHandle, '/storages');
  const testResponse = await requestJson(appHandle, '/storages/test', {
    method: 'POST',
    json: {
      type: 's3',
      config: { region: 'ap-southeast-1' },
    },
  });
  const loadBalanceResponse = await requestJson(appHandle, '/load-balance');
  const quotaStatsResponse = await requestJson(appHandle, '/quota-stats');
  const updateLoadBalanceResponse = await requestJson(appHandle, '/load-balance', {
    method: 'PUT',
    json: {
      strategy: 'weighted',
    },
  });
  const createStorageResponse = await requestJson(appHandle, '/storages', {
    method: 'POST',
    json: {
      id: 's3-2',
      type: 's3',
      name: '备份渠道',
      s3NonEmptyAction: 'keep',
      config: {
        bucket: 'bucket-1',
      },
    },
  });

  assert.equal(storagesResponse.status, 200);
  assert.equal(storagesResponse.body.data.list[0].config.secretAccessKey, '***');
  assert.equal(storagesResponse.body.data.list[0].usedBytes, 64);
  assert.equal(testResponse.status, 200);
  assert.equal(createStorageResponse.status, 200);
  assert.equal(createStorageResponse.body.message, '存储渠道已新增');
  assert.equal(loadBalanceResponse.body.data.strategy, 'weighted');
  assert.deepEqual(quotaStatsResponse.body.data.stats, { 's3-1': 64 });
  assert.equal(updateLoadBalanceResponse.status, 200);
  assert.deepEqual(serviceCalls, [
    { type: 's3', config: { region: 'ap-southeast-1' } },
    { updateLoadBalance: { strategy: 'weighted' } },
    {
      createStorage: {
        id: 's3-2',
        type: 's3',
        name: '备份渠道',
        s3NonEmptyAction: 'keep',
        config: {
          bucket: 'bucket-1',
        },
      },
    },
  ]);
});

test('createSystemStoragesRouter 会透传新增 S3 时的 409 冲突与 reason', async (t) => {
  const passthroughCache = createPassthroughCache();
  const appHandle = await startRouterApp(createSystemStoragesRouter({
    storagesListCache: passthroughCache,
    storagesStatsCache: passthroughCache,
    loadBalanceCache: passthroughCache,
    quotaStatsCache: passthroughCache,
    readRuntimeConfig: () => ({
      storage: {
        default: 's3-1',
        storages: [],
      },
    }),
    sanitizeStorageChannel: (storage) => storage,
    summarizeStorages: () => ({ total: 0, enabled: 0, allowUpload: 0, byType: {} }),
    storageManager: {
      getAllQuotaStats() {
        return {};
      },
      getUsageStats() {
        return {};
      },
    },
    storageConfigService: {
      async testStorageConnection() {
        return { ok: true };
      },
      async updateLoadBalance() {},
      async createStorage() {
        throw new ConflictError('S3 存储桶中已存在文件，请确认是否需要清空', 'S3_BUCKET_NOT_EMPTY');
      },
      async updateStorage() {
        return { id: 's3-1', type: 's3', config: {} };
      },
      async deleteStorage() {},
      async setDefaultStorage() {},
      async toggleStorage() {
        return true;
      },
    },
  }));
  t.after(() => appHandle.stop());

  const createStorageResponse = await requestJson(appHandle, '/storages', {
    method: 'POST',
    json: {
      id: 's3-2',
      type: 's3',
      name: '备份渠道',
      config: {
        bucket: 'bucket-1',
      },
    },
  });

  assert.equal(createStorageResponse.status, 409);
  assert.deepEqual(createStorageResponse.body, {
    code: 409,
    message: 'S3 存储桶中已存在文件，请确认是否需要清空',
    reason: 'S3_BUCKET_NOT_EMPTY',
  });
});

test('createSystemMaintenanceRouter 会返回 processing 与容量历史数据', async (t) => {
  const appHandle = await startRouterApp(createSystemMaintenanceRouter({
    maintenanceService: {
      triggerQuotaStatsRebuild() {
        return { status: 'processing' };
      },
      getQuotaHistory({ limit, storageId }) {
        return { history: [{ limit, storageId }] };
      },
    },
  }));
  t.after(() => appHandle.stop());

  const rebuildResponse = await requestJson(appHandle, '/maintenance/rebuild-quota-stats', {
    method: 'POST',
  });
  const historyResponse = await requestJson(appHandle, '/maintenance/quota-history?limit=5&storage_id=s3-1');

  assert.equal(rebuildResponse.status, 200);
  assert.equal(rebuildResponse.body.data.status, 'processing');
  assert.equal(historyResponse.status, 200);
  assert.deepEqual(historyResponse.body.data.history, [{
    limit: '5',
    storageId: 's3-1',
  }]);
});

test('createSystemRuntimeRouter 会返回注入的缓存与归档运行态信息', async (t) => {
  const calls = [];
  const appHandle = await startRouterApp(createSystemRuntimeRouter({
    getResponseCache: () => ({
      getStats() {
        return { hits: 9 };
      },
    }),
    invalidateAllCaches() {
      calls.push('invalidateAll');
    },
    getQuotaEventsArchive: () => ({
      getStats() {
        return { archivedEvents: 4 };
      },
    }),
    getArchiveScheduler: () => ({
      async runNow() {
        return { skipped: true };
      },
      getStatus() {
        return { enabled: false, hasTimer: false };
      },
    }),
  }));
  t.after(() => appHandle.stop());

  const cacheStatsResponse = await requestJson(appHandle, '/cache/stats');
  const cacheClearResponse = await requestJson(appHandle, '/cache/clear', {
    method: 'POST',
  });
  const archiveStatsResponse = await requestJson(appHandle, '/archive/stats');
  const archiveRunResponse = await requestJson(appHandle, '/archive/run', {
    method: 'POST',
  });
  const archiveSchedulerResponse = await requestJson(appHandle, '/archive/scheduler');

  assert.equal(cacheStatsResponse.body.data.hits, 9);
  assert.equal(cacheClearResponse.body.message, '缓存已清空');
  assert.equal(archiveStatsResponse.body.data.archivedEvents, 4);
  assert.equal(archiveRunResponse.body.message, '归档任务正在执行中，已跳过本次触发');
  assert.equal(archiveSchedulerResponse.body.data.hasTimer, false);
  assert.deepEqual(calls, ['invalidateAll']);
});

test('createSystemDashboardRouter 会返回注入统计结果并透传校验错误', async (t) => {
  const passthroughCache = createPassthroughCache();
  const appHandle = await startRouterApp(createSystemDashboardRouter({
    dashboardOverviewCache: passthroughCache,
    dashboardUploadTrendCache: passthroughCache,
    dashboardAccessStatsCache: passthroughCache,
    dashboardService: {
      getOverview() {
        return { totalFiles: 5 };
      },
      getUploadTrend(days) {
        if (days === '8') {
          throw new ValidationError('days 参数必须是 7、30 或 90');
        }
        return { trend: [{ date: '2026-04-14', count: 1 }] };
      },
      getAccessStats() {
        return { todayAccess: 3 };
      },
    },
  }));
  t.after(() => appHandle.stop());

  const overviewResponse = await requestJson(appHandle, '/dashboard/overview');
  const trendResponse = await requestJson(appHandle, '/dashboard/upload-trend?days=7');
  const trendErrorResponse = await requestJson(appHandle, '/dashboard/upload-trend?days=8');
  const accessStatsResponse = await requestJson(appHandle, '/dashboard/access-stats');

  assert.equal(overviewResponse.status, 200);
  assert.equal(overviewResponse.body.data.totalFiles, 5);
  assert.equal(trendResponse.status, 200);
  assert.equal(trendResponse.body.data.trend[0].count, 1);
  assert.equal(trendErrorResponse.status, 400);
  assert.equal(trendErrorResponse.body.message, 'days 参数必须是 7、30 或 90');
  assert.equal(accessStatsResponse.status, 200);
  assert.equal(accessStatsResponse.body.data.todayAccess, 3);
});
