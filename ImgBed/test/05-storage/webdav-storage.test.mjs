import assert from 'node:assert/strict';
import http from 'node:http';
import test from 'node:test';

import WebDAVStorage, {
  createBasicAuth,
  encodeWebDavPath,
  joinPath,
} from '../../src/storage/webdav.js';

function createResponse({
  status = 200,
  statusText = 'OK',
  body = null,
  headers = {},
} = {}) {
  return { status, statusText, body, headers };
}

async function readRequestBody(request) {
  const chunks = [];
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

async function createWebDavHarness(resolver) {
  const calls = [];

  let endpoint = '';
  const server = http.createServer(async (request, response) => {
    try {
      const body = await readRequestBody(request);
      const call = {
        url: `${endpoint}${request.url}`,
        method: request.method || 'GET',
        headers: { ...request.headers },
        body,
      };
      calls.push(call);

      const result = await resolver(call, calls.length - 1);
      response.statusCode = result.status || 200;
      response.statusMessage = result.statusText || 'OK';
      for (const [name, value] of Object.entries(result.headers || {})) {
        response.setHeader(name, value);
      }
      response.end(result.body ?? null);
    } catch (error) {
      response.statusCode = 500;
      response.end(error?.stack || error?.message || '测试服务异常');
    }
  });

  await new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      endpoint = `http://127.0.0.1:${address.port}`;
      resolve();
    });
  });

  return {
    endpoint,
    calls,
    async stop() {
      await new Promise((resolve) => server.close(resolve));
    },
  };
}

async function readStreamAsText(stream) {
  const chunks = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString('utf8');
}

test('WebDAV 路径拼接、编码与 Basic 认证生成符合预期', () => {
  assert.equal(joinPath('/images/', '子 目录', '/demo #1.png'), 'images/子 目录/demo #1.png');
  assert.equal(
    encodeWebDavPath('images/子 目录/demo #1.png'),
    'images/%E5%AD%90%20%E7%9B%AE%E5%BD%95/demo%20%231.png',
  );
  assert.equal(createBasicAuth('user', 'pass'), 'Basic dXNlcjpwYXNz');
});

test('WebDAV 匿名请求不带 Authorization，Basic 配置会带认证头', async (t) => {
  const harness = await createWebDavHarness(() => createResponse({ status: 200 }));
  t.after(() => harness.stop());

  const anonymous = new WebDAVStorage({ endpoint: harness.endpoint });
  assert.equal(await anonymous.exists('demo.png'), true);
  assert.equal(harness.calls[0].headers.authorization, undefined);

  const authed = new WebDAVStorage({
    endpoint: harness.endpoint,
    username: 'user',
    password: 'pass',
  });
  assert.equal(await authed.exists('demo.png'), true);
  assert.equal(harness.calls[1].headers.authorization, 'Basic dXNlcjpwYXNz');
});

test('WebDAV put 会递归创建目录并写入文件', async (t) => {
  const harness = await createWebDavHarness((call) => {
    if (call.method === 'MKCOL') {
      return createResponse({ status: 201, statusText: 'Created' });
    }
    return createResponse({ status: 201, statusText: 'Created' });
  });
  t.after(() => harness.stop());

  const storage = new WebDAVStorage({
    endpoint: `${harness.endpoint}/root/`,
    pathPrefix: '/images/2026',
  });

  const result = await storage.put(Buffer.from('demo'), {
    fileName: '子 目录/demo #1.png',
    mimeType: 'image/png',
  });

  assert.deepEqual(result, {
    storageKey: 'images/2026/子 目录/demo #1.png',
    size: 4,
    deleteToken: null,
  });
  assert.deepEqual(harness.calls.map((call) => [call.method, call.url]), [
    ['MKCOL', `${harness.endpoint}/root/images`],
    ['MKCOL', `${harness.endpoint}/root/images/2026`],
    ['MKCOL', `${harness.endpoint}/root/images/2026/%E5%AD%90%20%E7%9B%AE%E5%BD%95`],
    ['PUT', `${harness.endpoint}/root/images/2026/%E5%AD%90%20%E7%9B%AE%E5%BD%95/demo%20%231.png`],
  ]);
  assert.equal(harness.calls[3].headers['content-type'], 'image/png');
  assert.equal(harness.calls[3].headers['content-length'], '4');
  assert.equal(Buffer.compare(harness.calls[3].body, Buffer.from('demo')), 0);
});

test('WebDAV MKCOL 遇到 405 幂等通过，409 会抛出目录创建失败', async (t) => {
  const okHarness = await createWebDavHarness((call) => (
    call.method === 'MKCOL'
      ? createResponse({ status: 405, statusText: 'Method Not Allowed' })
      : createResponse({ status: 201, statusText: 'Created' })
  ));
  t.after(() => okHarness.stop());

  const storage = new WebDAVStorage({
    endpoint: okHarness.endpoint,
    pathPrefix: 'images',
  });
  const result = await storage.put(Buffer.from('demo'), { fileName: 'nested/demo.png' });
  assert.equal(result.storageKey, 'images/nested/demo.png');

  const conflictHarness = await createWebDavHarness(() => createResponse({ status: 409, statusText: 'Conflict' }));
  t.after(() => conflictHarness.stop());

  const conflictStorage = new WebDAVStorage({
    endpoint: conflictHarness.endpoint,
    pathPrefix: 'images',
  });
  await assert.rejects(
    () => conflictStorage.put(Buffer.from('demo'), { fileName: 'nested/demo.png' }),
    /创建目录失败: images/,
  );
});

test('WebDAV getStreamResponse 会透传 Range 并返回统一读取结果', async (t) => {
  const harness = await createWebDavHarness(() => createResponse({
    status: 206,
    statusText: 'Partial Content',
    body: 'bcd',
    headers: {
      'content-length': '3',
      'content-range': 'bytes 1-3/6',
      'accept-ranges': 'bytes',
      'content-type': 'image/png',
    },
  }));
  t.after(() => harness.stop());

  const storage = new WebDAVStorage({ endpoint: harness.endpoint });
  const result = await storage.getStreamResponse('demo.png', { start: 1, end: 3 });

  assert.equal(harness.calls[0].method, 'GET');
  assert.equal(harness.calls[0].headers.range, 'bytes=1-3');
  assert.equal(result.contentLength, 3);
  assert.equal(result.totalSize, 6);
  assert.equal(result.statusCode, 206);
  assert.equal(result.acceptRanges, true);
  assert.equal(result.contentType, 'image/png');
  assert.equal(await readStreamAsText(result.stream), 'bcd');
});

test('WebDAV delete 与 exists 会按状态码返回幂等结果', async (t) => {
  const harness = await createWebDavHarness((call) => {
    if (call.method === 'DELETE') {
      return createResponse({ status: 404, statusText: 'Not Found' });
    }
    return createResponse({ status: 404, statusText: 'Not Found' });
  });
  t.after(() => harness.stop());

  const storage = new WebDAVStorage({ endpoint: harness.endpoint });

  assert.equal(await storage.delete('gone.png'), true);
  assert.equal(await storage.exists('gone.png'), false);
  assert.deepEqual(harness.calls.map((call) => call.method), ['DELETE', 'HEAD']);
});

test('WebDAV testConnection 只接受可用响应，不把 404 当成功', async (t) => {
  const okHarness = await createWebDavHarness(() => createResponse({ status: 405, statusText: 'Method Not Allowed' }));
  t.after(() => okHarness.stop());

  const storage = new WebDAVStorage({ endpoint: okHarness.endpoint });
  assert.deepEqual(await storage.testConnection(), {
    ok: true,
    message: 'WebDAV 连接成功',
  });

  const missingHarness = await createWebDavHarness(() => createResponse({ status: 404, statusText: 'Not Found' }));
  t.after(() => missingHarness.stop());

  const missingStorage = new WebDAVStorage({ endpoint: missingHarness.endpoint });
  const result = await missingStorage.testConnection();
  assert.equal(result.ok, false);
  assert.match(result.message, /资源不存在|Not Found|连接失败/);
});

test('WebDAV testConnection 会先确保 pathPrefix 目录存在', async (t) => {
  const harness = await createWebDavHarness((call) => {
    if (call.method === 'MKCOL') {
      return createResponse({ status: 201, statusText: 'Created' });
    }
    return createResponse({ status: 200 });
  });
  t.after(() => harness.stop());

  const storage = new WebDAVStorage({
    endpoint: harness.endpoint,
    pathPrefix: 'images/2026',
  });
  const result = await storage.testConnection();

  assert.equal(result.ok, true);
  assert.deepEqual(harness.calls.map((call) => [call.method, call.url]), [
    ['MKCOL', `${harness.endpoint}/images`],
    ['MKCOL', `${harness.endpoint}/images/2026`],
    ['HEAD', `${harness.endpoint}/images/2026`],
  ]);
});

test('WebDAV getUrl 会优先使用 publicUrl，否则返回 webdav 标识', async () => {
  const publicStorage = new WebDAVStorage({
    endpoint: 'https://dav.example.com',
    publicUrl: 'https://cdn.example.com/base/',
  });
  assert.equal(
    await publicStorage.getUrl('images/子 目录/demo #1.png'),
    'https://cdn.example.com/base/images/%E5%AD%90%20%E7%9B%AE%E5%BD%95/demo%20%231.png',
  );

  const privateStorage = new WebDAVStorage({ endpoint: 'https://dav.example.com' });
  assert.equal(await privateStorage.getUrl('images/demo.png'), 'webdav://images/demo.png');
});
