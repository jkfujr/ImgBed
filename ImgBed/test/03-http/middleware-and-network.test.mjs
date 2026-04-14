import assert from 'node:assert/strict';
import test from 'node:test';

import express from 'express';

import asyncHandler from '../../src/middleware/asyncHandler.js';
import { cacheMiddleware } from '../../src/middleware/cache.js';
import { notFoundHandler, registerErrorHandlers } from '../../src/middleware/errorHandler.js';
import { createProxyFetcher, normalizeProxyUrl } from '../../src/network/proxy-core.js';
import { initResponseCache } from '../../src/services/cache/response-cache.js';
import { ConfigFileError, ValidationError } from '../../src/errors/AppError.js';
import { success } from '../../src/utils/response.js';
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

test('normalizeProxyUrl 会校验协议并返回标准化结果', () => {
  assert.deepEqual(normalizeProxyUrl('  http://user:pass@127.0.0.1:7890  '), {
    url: 'http://user:pass@127.0.0.1:7890/',
    protocol: 'http:',
    hostname: '127.0.0.1',
    port: '7890',
    username: 'user',
    password: 'pass',
  });
  assert.deepEqual(normalizeProxyUrl(''), null);
  assert.throws(() => normalizeProxyUrl('ftp://127.0.0.1:21'), /不支持的代理协议/);
  assert.throws(() => normalizeProxyUrl('not-a-url'), /代理地址格式无效/);
});

test('createProxyFetcher 只在提供代理时注入 dispatcher，并复用同一代理实例', async () => {
  const fetchCalls = [];
  const agentCreations = [];

  class ProxyAgentDouble {
    constructor(url) {
      this.url = url;
      agentCreations.push(url);
    }
  }

  const fetchWithProxy = createProxyFetcher({
    fetchImpl: async (url, options) => {
      fetchCalls.push({ url, options });
      return { ok: true, url, options };
    },
    ProxyAgentImpl: ProxyAgentDouble,
  });

  await fetchWithProxy('https://example.com/no-proxy');
  await fetchWithProxy('https://example.com/with-proxy', { method: 'POST' }, 'http://127.0.0.1:7890');
  await fetchWithProxy('https://example.com/reuse-proxy', {}, 'http://127.0.0.1:7890');

  assert.equal(fetchCalls[0].options.dispatcher, undefined);
  assert.equal(fetchCalls[1].options.dispatcher.url, 'http://127.0.0.1:7890/');
  assert.equal(fetchCalls[2].options.dispatcher, fetchCalls[1].options.dispatcher);
  assert.deepEqual(agentCreations, ['http://127.0.0.1:7890/']);
});

test('cacheMiddleware 会按身份隔离 GET 缓存，并跳过非 GET 请求', async (t) => {
  const cache = initResponseCache({
    enabled: true,
    ttlSeconds: 60,
    maxKeys: 32,
  });
  t.after(() => cache.destroy());

  let counter = 0;
  const appHandle = await startExpressApp((app) => {
    app.use((req, _res, next) => {
      const authName = req.get('X-Auth-User');
      if (authName) {
        req.auth = {
          type: 'admin_jwt',
          username: authName,
        };
      }
      next();
    });

    app.all('/demo', cacheMiddleware({ prefix: 'demo:items' }), (req, res) => {
      counter += 1;
      res.json(success({ counter, method: req.method }));
    });
  });
  t.after(() => appHandle.stop());

  const firstAnonymous = await requestServer(appHandle.server, '/demo');
  const secondAnonymous = await requestServer(appHandle.server, '/demo');
  const firstAlice = await requestServer(appHandle.server, '/demo', {
    headers: { 'X-Auth-User': 'alice' },
  });
  const postAlice = await requestServer(appHandle.server, '/demo', {
    method: 'POST',
    headers: { 'X-Auth-User': 'alice' },
  });

  const firstAnonymousBody = JSON.parse(firstAnonymous.body);
  const secondAnonymousBody = JSON.parse(secondAnonymous.body);
  const firstAliceBody = JSON.parse(firstAlice.body);
  const postAliceBody = JSON.parse(postAlice.body);
  const stats = cache.getStats();

  assert.equal(firstAnonymousBody.data.counter, 1);
  assert.equal(secondAnonymousBody.data.counter, 1);
  assert.equal(firstAliceBody.data.counter, 2);
  assert.equal(postAliceBody.data.counter, 3);
  assert.equal(stats.hits, 1);
  assert.equal(stats.sets, 2);
});

test('asyncHandler、notFoundHandler 和 registerErrorHandlers 会输出一致的 HTTP 错误响应', async (t) => {
  const appHandle = await startExpressApp((app) => {
    app.get('/validation', asyncHandler(async () => {
      throw new ValidationError('参数错误');
    }));

    app.get('/config-error', asyncHandler(async () => {
      throw new ConfigFileError({
        message: '原始配置错误',
        configPath: './data/config.json',
      });
    }));

    app.get('/boom', asyncHandler(async () => {
      throw new Error('未知异常');
    }));

    app.use(notFoundHandler);
    registerErrorHandlers(app);
  });
  t.after(() => appHandle.stop());

  const validationResponse = await requestServer(appHandle.server, '/validation');
  const configResponse = await requestServer(appHandle.server, '/config-error');
  const boomResponse = await requestServer(appHandle.server, '/boom');
  const missingResponse = await requestServer(appHandle.server, '/missing');

  assert.deepEqual(JSON.parse(validationResponse.body), {
    code: 400,
    message: '参数错误',
  });
  assert.deepEqual(JSON.parse(configResponse.body), {
    code: 500,
    message: '配置文件不可用，请修复后重试',
  });
  assert.deepEqual(JSON.parse(boomResponse.body), {
    code: 500,
    message: '未知异常',
  });
  assert.deepEqual(JSON.parse(missingResponse.body), {
    code: 404,
    message: '未找到请求的资源',
  });
});
