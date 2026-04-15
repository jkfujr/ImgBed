import assert from 'node:assert/strict';
import test from 'node:test';

import express from 'express';

import { buildIdentityCacheKey, cacheMiddleware } from '../../src/middleware/cache.js';
import { success } from '../../src/utils/response.js';
import { createCacheInvalidationService } from '../../src/services/cache/cache-invalidation-service.js';
import {
  DASHBOARD_CACHES_PREFIX,
  DASHBOARD_UPLOAD_TREND_CACHE_PREFIX,
  FILES_CACHE_PREFIX,
  FILES_LIST_CACHE_PREFIX,
  LOAD_BALANCE_CACHE_PREFIX,
  QUOTA_STATS_CACHE_PREFIX,
  STORAGE_LIST_CACHE_PREFIX,
  STORAGE_STATS_CACHE_PREFIX,
  SYSTEM_CONFIG_CACHE_PREFIX,
} from '../../src/services/cache/cache-groups.js';
import {
  destroyResponseCache,
  getResponseCache,
  initResponseCache,
} from '../../src/services/cache/response-cache.js';
import { filesListCache } from '../../src/routes/files/cache.js';
import {
  dashboardUploadTrendCache,
  systemConfigCache,
} from '../../src/routes/system/cache-factories.js';
import { requestServer } from '../helpers/runtime-test-helpers.mjs';

async function startExpressApp(buildApp) {
  const app = express();
  buildApp(app);

  const server = await new Promise((resolve) => {
    const instance = app.listen(0, '127.0.0.1', () => resolve(instance));
  });

  return {
    server,
    async stop() {
      await new Promise((resolve) => server.close(resolve));
    },
  };
}

test('cacheMiddleware 仍会按身份隔离 GET 缓存', { concurrency: false }, async (t) => {
  destroyResponseCache();
  initResponseCache({
    enabled: true,
    ttlSeconds: 60,
    maxKeys: 32,
  });
  t.after(() => destroyResponseCache());

  let counter = 0;
  const appHandle = await startExpressApp((app) => {
    app.use((req, _res, next) => {
      const authName = req.headers['x-auth-user'];
      if (authName) {
        req.auth = {
          type: 'admin_jwt',
          username: authName,
        };
      }
      next();
    });

    app.get('/demo', cacheMiddleware({ prefix: 'demo:items' }), (_req, res) => {
      counter += 1;
      res.json(success({ counter }));
    });
  });
  t.after(() => appHandle.stop());

  const anonymousFirst = JSON.parse((await requestServer(appHandle.server, '/demo')).body);
  const anonymousSecond = JSON.parse((await requestServer(appHandle.server, '/demo')).body);
  const aliceFirst = JSON.parse((await requestServer(appHandle.server, '/demo', {
    headers: {
      'X-Auth-User': 'alice',
    },
  })).body);

  assert.equal(anonymousFirst.data.counter, 1);
  assert.equal(anonymousSecond.data.counter, 1);
  assert.equal(aliceFirst.data.counter, 2);
});

test('files 与 system 场景缓存工厂会使用统一前缀目录生成缓存键', { concurrency: false }, async (t) => {
  destroyResponseCache();
  initResponseCache({
    enabled: true,
    ttlSeconds: 60,
    maxKeys: 32,
  });
  t.after(() => destroyResponseCache());

  const appHandle = await startExpressApp((app) => {
    app.use((req, _res, next) => {
      req.auth = {
        type: 'admin_jwt',
        username: 'alice',
      };
      next();
    });

    app.get('/files', filesListCache(), (_req, res) => {
      res.json(success({ ok: true }));
    });
    app.get('/system/config', systemConfigCache(), (_req, res) => {
      res.json(success({ ok: true }));
    });
    app.get('/system/dashboard/upload-trend', dashboardUploadTrendCache(), (_req, res) => {
      res.json(success({ ok: true }));
    });
  });
  t.after(() => appHandle.stop());

  await requestServer(appHandle.server, '/files?page=2&pageSize=10&directory=%2Fgallery&search=cover');
  await requestServer(appHandle.server, '/system/config');
  await requestServer(appHandle.server, '/system/dashboard/upload-trend?days=30');

  const keys = Array.from(getResponseCache().cache.keys());
  const filesKey = buildIdentityCacheKey(FILES_LIST_CACHE_PREFIX, {
    auth: { type: 'admin_jwt', username: 'alice' },
  }, {
    mode: 'search',
    page: '2',
    pageSize: '10',
    directory: '/gallery',
    search: 'cover',
  });
  const systemConfigKey = buildIdentityCacheKey(SYSTEM_CONFIG_CACHE_PREFIX, {
    auth: { type: 'admin_jwt', username: 'alice' },
  });
  const trendKey = buildIdentityCacheKey(DASHBOARD_UPLOAD_TREND_CACHE_PREFIX, {
    auth: { type: 'admin_jwt', username: 'alice' },
  }, {
    days: '30',
  });

  assert.ok(keys.includes(filesKey));
  assert.ok(keys.includes(systemConfigKey));
  assert.ok(keys.includes(trendKey));
});

test('createCacheInvalidationService 会按域失效正确前缀且不依赖 middleware 模块', () => {
  const deleteCalls = [];
  const clearCalls = [];
  const service = createCacheInvalidationService({
    getCache: () => ({
      deleteByPrefix(prefix) {
        deleteCalls.push(prefix);
      },
      clear() {
        clearCalls.push('clear');
      },
    }),
    logger: {
      info() {},
    },
  });

  service.invalidateFilesCache();
  service.invalidateSystemConfigCache();
  service.invalidateStorageCaches();
  service.invalidateDashboardCaches();
  service.invalidateAllCaches();

  assert.deepEqual(deleteCalls, [
    FILES_CACHE_PREFIX,
    SYSTEM_CONFIG_CACHE_PREFIX,
    STORAGE_LIST_CACHE_PREFIX,
    STORAGE_STATS_CACHE_PREFIX,
    QUOTA_STATS_CACHE_PREFIX,
    LOAD_BALANCE_CACHE_PREFIX,
    DASHBOARD_CACHES_PREFIX,
  ]);
  assert.deepEqual(clearCalls, ['clear']);
});
