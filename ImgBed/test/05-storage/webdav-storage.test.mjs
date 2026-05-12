import assert from 'node:assert/strict';
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
  return new Response(body, {
    status,
    statusText,
    headers,
  });
}

function createFetchHarness(resolver) {
  const calls = [];
  const originalFetch = global.fetch;

  global.fetch = async (url, options = {}) => {
    calls.push({
      url: String(url),
      method: options.method || 'GET',
      headers: { ...(options.headers || {}) },
      body: options.body,
    });
    return resolver(calls[calls.length - 1], calls.length - 1);
  };

  return {
    calls,
    restore() {
      global.fetch = originalFetch;
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
  const anonymousHarness = createFetchHarness(() => createResponse({ status: 200 }));
  t.after(() => anonymousHarness.restore());

  const anonymous = new WebDAVStorage({ endpoint: 'https://dav.example.com' });
  assert.equal(await anonymous.exists('demo.png'), true);
  assert.equal(anonymousHarness.calls[0].headers.Authorization, undefined);

  anonymousHarness.restore();
  const authHarness = createFetchHarness(() => createResponse({ status: 200 }));
  t.after(() => authHarness.restore());

  const authed = new WebDAVStorage({
    endpoint: 'https://dav.example.com',
    username: 'user',
    password: 'pass',
  });
  assert.equal(await authed.exists('demo.png'), true);
  assert.equal(authHarness.calls[0].headers.Authorization, 'Basic dXNlcjpwYXNz');
});

test('WebDAV put 会递归创建目录并写入文件', async (t) => {
  const harness = createFetchHarness((call) => {
    if (call.method === 'MKCOL') {
      return createResponse({ status: 201, statusText: 'Created' });
    }
    return createResponse({ status: 201, statusText: 'Created' });
  });
  t.after(() => harness.restore());

  const storage = new WebDAVStorage({
    endpoint: 'https://dav.example.com/root/',
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
    ['MKCOL', 'https://dav.example.com/root/images'],
    ['MKCOL', 'https://dav.example.com/root/images/2026'],
    ['MKCOL', 'https://dav.example.com/root/images/2026/%E5%AD%90%20%E7%9B%AE%E5%BD%95'],
    ['PUT', 'https://dav.example.com/root/images/2026/%E5%AD%90%20%E7%9B%AE%E5%BD%95/demo%20%231.png'],
  ]);
  assert.equal(harness.calls[3].headers['Content-Type'], 'image/png');
  assert.equal(harness.calls[3].headers['Content-Length'], '4');
  assert.equal(Buffer.compare(harness.calls[3].body, Buffer.from('demo')), 0);
});

test('WebDAV MKCOL 遇到 405 幂等通过，409 会抛出目录创建失败', async (t) => {
  const okHarness = createFetchHarness((call) => (
    call.method === 'MKCOL'
      ? createResponse({ status: 405, statusText: 'Method Not Allowed' })
      : createResponse({ status: 201, statusText: 'Created' })
  ));
  t.after(() => okHarness.restore());

  const storage = new WebDAVStorage({
    endpoint: 'https://dav.example.com',
    pathPrefix: 'images',
  });
  const result = await storage.put(Buffer.from('demo'), { fileName: 'nested/demo.png' });
  assert.equal(result.storageKey, 'images/nested/demo.png');

  okHarness.restore();
  const conflictHarness = createFetchHarness(() => createResponse({ status: 409, statusText: 'Conflict' }));
  t.after(() => conflictHarness.restore());

  const conflictStorage = new WebDAVStorage({
    endpoint: 'https://dav.example.com',
    pathPrefix: 'images',
  });
  await assert.rejects(
    () => conflictStorage.put(Buffer.from('demo'), { fileName: 'nested/demo.png' }),
    /创建目录失败: images/,
  );
});

test('WebDAV getStreamResponse 会透传 Range 并返回统一读取结果', async (t) => {
  const harness = createFetchHarness(() => createResponse({
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
  t.after(() => harness.restore());

  const storage = new WebDAVStorage({ endpoint: 'https://dav.example.com' });
  const result = await storage.getStreamResponse('demo.png', { start: 1, end: 3 });

  assert.equal(harness.calls[0].method, 'GET');
  assert.equal(harness.calls[0].headers.Range, 'bytes=1-3');
  assert.equal(result.contentLength, 3);
  assert.equal(result.totalSize, 6);
  assert.equal(result.statusCode, 206);
  assert.equal(result.acceptRanges, true);
  assert.equal(result.contentType, 'image/png');
  assert.equal(await readStreamAsText(result.stream), 'bcd');
});

test('WebDAV delete 与 exists 会按状态码返回幂等结果', async (t) => {
  const harness = createFetchHarness((call) => {
    if (call.method === 'DELETE') {
      return createResponse({ status: 404, statusText: 'Not Found' });
    }
    return createResponse({ status: 404, statusText: 'Not Found' });
  });
  t.after(() => harness.restore());

  const storage = new WebDAVStorage({ endpoint: 'https://dav.example.com' });

  assert.equal(await storage.delete('gone.png'), true);
  assert.equal(await storage.exists('gone.png'), false);
  assert.deepEqual(harness.calls.map((call) => call.method), ['DELETE', 'HEAD']);
});

test('WebDAV testConnection 只接受可用响应，不把 404 当成功', async (t) => {
  const okHarness = createFetchHarness(() => createResponse({ status: 405, statusText: 'Method Not Allowed' }));
  t.after(() => okHarness.restore());

  const storage = new WebDAVStorage({ endpoint: 'https://dav.example.com' });
  assert.deepEqual(await storage.testConnection(), {
    ok: true,
    message: 'WebDAV 连接成功',
  });

  okHarness.restore();
  const missingHarness = createFetchHarness(() => createResponse({ status: 404, statusText: 'Not Found' }));
  t.after(() => missingHarness.restore());

  const missingStorage = new WebDAVStorage({ endpoint: 'https://dav.example.com' });
  const result = await missingStorage.testConnection();
  assert.equal(result.ok, false);
  assert.match(result.message, /资源不存在|Not Found|连接失败/);
});

test('WebDAV testConnection 会先确保 pathPrefix 目录存在', async (t) => {
  const harness = createFetchHarness((call) => {
    if (call.method === 'MKCOL') {
      return createResponse({ status: 201, statusText: 'Created' });
    }
    return createResponse({ status: 200 });
  });
  t.after(() => harness.restore());

  const storage = new WebDAVStorage({
    endpoint: 'https://dav.example.com',
    pathPrefix: 'images/2026',
  });
  const result = await storage.testConnection();

  assert.equal(result.ok, true);
  assert.deepEqual(harness.calls.map((call) => [call.method, call.url]), [
    ['MKCOL', 'https://dav.example.com/images'],
    ['MKCOL', 'https://dav.example.com/images/2026'],
    ['HEAD', 'https://dav.example.com/images/2026'],
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
