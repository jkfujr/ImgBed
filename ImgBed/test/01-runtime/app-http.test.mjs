import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import {
  cleanupPath,
  createTempAppRoot,
  requestServer,
  resolveProjectModuleUrl,
  startHttpApp,
} from '../helpers/runtime-test-helpers.mjs';

test('app.js 会为 API、文件直链和 SPA 导航返回清晰的边界语义', async (t) => {
  const appRoot = createTempAppRoot('imgbed-app-');
  const staticRoot = path.join(appRoot, 'static');
  fs.mkdirSync(staticRoot, { recursive: true });
  fs.writeFileSync(path.join(staticRoot, 'index.html'), '<!doctype html><title>ImgBed Test</title>', 'utf8');

  const previousAppRoot = process.env.IMGBED_APP_ROOT;
  process.env.IMGBED_APP_ROOT = appRoot;
  const configModule = await import(resolveProjectModuleUrl('src', 'config', 'index.js'));
  configModule.loadStartupConfig();
  const { sqlite } = await import(resolveProjectModuleUrl('src', 'database', 'index.js'));
  const { initSchema } = await import(resolveProjectModuleUrl('src', 'database', 'schema.js'));
  initSchema(sqlite);
  if (previousAppRoot === undefined) {
    delete process.env.IMGBED_APP_ROOT;
  } else {
    process.env.IMGBED_APP_ROOT = previousAppRoot;
  }

  const runtime = await startHttpApp({ appRoot });
  t.after(async () => {
    await runtime.stop();
    sqlite.close();
    cleanupPath(appRoot);
  });

  const corsResponse = await requestServer(runtime.server, '/api/not-found', {
    method: 'OPTIONS',
  });
  assert.equal(corsResponse.statusCode, 204);
  assert.equal(corsResponse.headers['access-control-allow-origin'], '*');

  const apiMissResponse = await requestServer(runtime.server, '/api/not-found');
  assert.equal(apiMissResponse.statusCode, 404);
  assert.deepEqual(JSON.parse(apiMissResponse.body), {
    code: 404,
    message: '未找到请求的资源',
  });

  const apiPostMissResponse = await requestServer(runtime.server, '/api/not-found', {
    method: 'POST',
  });
  assert.equal(apiPostMissResponse.statusCode, 404);
  assert.deepEqual(JSON.parse(apiPostMissResponse.body), {
    code: 404,
    message: '未找到请求的资源',
  });

  const loginSpaResponse = await requestServer(runtime.server, '/login', {
    headers: {
      Accept: 'text/html',
    },
  });
  assert.equal(loginSpaResponse.statusCode, 200);
  assert.match(loginSpaResponse.body, /<title>ImgBed Test<\/title>/);

  const adminSpaResponse = await requestServer(runtime.server, '/admin/files', {
    headers: {
      Accept: 'application/xhtml+xml',
    },
  });
  assert.equal(adminSpaResponse.statusCode, 200);
  assert.match(adminSpaResponse.body, /<title>ImgBed Test<\/title>/);

  const loginJsonResponse = await requestServer(runtime.server, '/login', {
    headers: {
      Accept: 'application/json',
    },
  });
  assert.equal(loginJsonResponse.statusCode, 404);
  assert.deepEqual(JSON.parse(loginJsonResponse.body), {
    code: 404,
    message: '未找到请求的资源',
  });

  const assetMissResponse = await requestServer(runtime.server, '/missing.css', {
    headers: {
      Accept: 'text/html',
    },
  });
  assert.equal(assetMissResponse.statusCode, 404);
  assert.deepEqual(JSON.parse(assetMissResponse.body), {
    code: 404,
    message: '未找到请求的资源',
  });

  const fileIdResponse = await requestServer(runtime.server, '/0123456789ab_demo.png', {
    headers: {
      Accept: 'text/html',
    },
  });
  assert.equal(fileIdResponse.statusCode, 404);
  assert.deepEqual(JSON.parse(fileIdResponse.body), {
    code: 404,
    message: '文件未找到或标识符无效',
  });
});
