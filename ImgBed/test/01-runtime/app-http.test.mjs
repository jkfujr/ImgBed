import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createTempAppRoot,
  requestServer,
  startHttpApp,
} from '../helpers/runtime-test-helpers.mjs';

test('app.js 当前会让未命中 API 请求落入 SPA fallback，而不是 JSON 404', async (t) => {
  const appRoot = createTempAppRoot('imgbed-app-');

  const runtime = await startHttpApp({ appRoot });
  t.after(async () => {
    await runtime.stop();
  });

  const corsResponse = await requestServer(runtime.server, '/api/not-found', {
    method: 'OPTIONS',
  });
  assert.equal(corsResponse.statusCode, 204);
  assert.equal(corsResponse.headers['access-control-allow-origin'], '*');

  const apiMissResponse = await requestServer(runtime.server, '/api/not-found');
  assert.equal(apiMissResponse.statusCode, 200);
  assert.match(apiMissResponse.body, /ImgBed 后端 API 正在运行！前端文件未找到，请先构建前端。/);

  const frontendMissResponse = await requestServer(runtime.server, '/frontend/not-found');
  assert.equal(frontendMissResponse.statusCode, 200);
  assert.match(frontendMissResponse.body, /ImgBed 后端 API 正在运行！前端文件未找到，请先构建前端。/);
});
