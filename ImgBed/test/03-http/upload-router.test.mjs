import assert from 'node:assert/strict';
import test from 'node:test';

import express from 'express';

import {
  createTempAppRoot,
  resolveProjectModuleUrl,
} from '../helpers/runtime-test-helpers.mjs';

const appRoot = createTempAppRoot('imgbed-03-upload-router-');
process.env.IMGBED_APP_ROOT = appRoot;

const configModule = await import(resolveProjectModuleUrl('src', 'config', 'index.js'));
configModule.loadStartupConfig();

const { ValidationError, QuotaExceededError } = await import(resolveProjectModuleUrl('src', 'errors', 'AppError.js'));
const { notFoundHandler, registerErrorHandlers } = await import(resolveProjectModuleUrl('src', 'middleware', 'errorHandler.js'));
const { createUploadRouter } = await import(resolveProjectModuleUrl('src', 'routes', 'upload.js'));

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

test('createUploadRouter 会使用注入应用服务处理请求并保持成功响应契约', async (t) => {
  const middlewareCalls = [];
  const serviceCalls = [];

  const appHandle = await startRouterApp(createUploadRouter({
    guestUploadAuth(req, _res, next) {
      middlewareCalls.push('guest-auth');
      req.auth = {
        type: 'guest',
        username: 'guest-user',
        permissions: ['upload:image'],
      };
      next();
    },
    requirePermission(permission) {
      middlewareCalls.push(`permission:${permission}`);
      return (_req, _res, next) => {
        middlewareCalls.push('permission-middleware');
        next();
      };
    },
    uploadMiddleware(req, _res, next) {
      middlewareCalls.push('upload-middleware');
      req.body = {
        directory: '/gallery',
        tags: 'cover,banner',
        is_public: '1',
      };
      req.file = {
        originalname: 'demo.png',
        mimetype: 'image/png',
        size: 4,
        buffer: Buffer.from('demo'),
      };
      next();
    },
    uploadApplicationService: {
      async handleUpload(input) {
        serviceCalls.push(input);
        return {
          data: {
            id: '0123456789ab_demo.png',
            url: '/0123456789ab_demo.png',
            file_name: '0123456789ab_demo.png',
            original_name: 'demo.png',
            size: 4,
            width: 1,
            height: 1,
          },
          message: '文件上传成功',
        };
      },
    },
  }));
  t.after(() => appHandle.stop());

  const response = await requestJson(appHandle, '/', {
    method: 'POST',
    headers: {
      'X-Forwarded-For': '203.0.113.20',
    },
    json: {
      ignored: true,
    },
  });

  assert.equal(response.status, 200);
  assert.equal(response.body.code, 0);
  assert.equal(response.body.message, '文件上传成功');
  assert.equal(response.body.data.id, '0123456789ab_demo.png');
  assert.deepEqual(middlewareCalls, [
    'permission:upload:image',
    'guest-auth',
    'permission-middleware',
    'upload-middleware',
  ]);
  assert.equal(serviceCalls.length, 1);
  assert.equal(serviceCalls[0].clientIp, '203.0.113.20');
  assert.equal(serviceCalls[0].auth.username, 'guest-user');
  assert.deepEqual(serviceCalls[0].body, {
    directory: '/gallery',
    tags: 'cover,banner',
    is_public: '1',
  });
  assert.equal(serviceCalls[0].file.originalname, 'demo.png');
});

test('createUploadRouter 会通过现有错误链返回应用服务抛出的业务错误', async (t) => {
  const appHandle = await startRouterApp(createUploadRouter({
    guestUploadAuth(req, _res, next) {
      req.auth = {
        type: 'guest',
        username: 'guest-user',
        permissions: ['upload:image'],
      };
      next();
    },
    requirePermission() {
      return (_req, _res, next) => next();
    },
    uploadMiddleware(req, _res, next) {
      req.file = {
        originalname: 'demo.png',
        mimetype: 'image/png',
        size: 4,
        buffer: Buffer.from('demo'),
      };
      next();
    },
    uploadApplicationService: {
      async handleUpload(input) {
        if (input.body.mode === 'validation') {
          throw new ValidationError('校验失败');
        }

        throw new QuotaExceededError('容量不足');
      },
    },
  }));
  t.after(() => appHandle.stop());

  const validationResponse = await requestJson(appHandle, '/', {
    method: 'POST',
    json: {
      mode: 'validation',
    },
  });
  const quotaResponse = await requestJson(appHandle, '/', {
    method: 'POST',
    json: {
      mode: 'quota',
    },
  });

  assert.equal(validationResponse.status, 400);
  assert.equal(validationResponse.body.message, '校验失败');
  assert.equal(quotaResponse.status, 403);
  assert.equal(quotaResponse.body.message, '容量不足');
});
