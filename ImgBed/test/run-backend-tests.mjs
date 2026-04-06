import test from 'node:test';
import assert from 'node:assert/strict';

import { parsePermissions, normalizePermissions, hashApiToken } from '../src/utils/apiToken.js';
import { buildPath } from '../src/services/directories/directory-operations.js';
import { validateTokenInput, createTokenRecord } from '../src/services/api-tokens/create-token.js';
import { createFilesError } from '../src/services/files/migrate-file.js';
import { buildQuotaEvent, normalizeErrorMessage } from '../src/services/system/storage-operations.js';
import { normalizeProxyUrl, fetchWithProxy, __setDepsForTest, __resetDepsForTest } from '../src/network/proxy.js';

test('normalizePermissions 仅保留合法权限并去重', () => {
  const permissions = normalizePermissions(['upload:image', 'files:read', 'files:read', 'invalid']);
  assert.deepEqual(permissions, ['upload:image', 'files:read']);
});

test('parsePermissions 在非法 JSON 时返回空数组', () => {
  assert.deepEqual(parsePermissions('{bad json}'), []);
});

test('hashApiToken 对相同 token 产生稳定结果', () => {
  const token = 'ib_test.secret';
  assert.equal(hashApiToken(token), hashApiToken(token));
  assert.equal(hashApiToken(token).length, 64);
});

test('buildPath 正确拼接目录', () => {
  assert.equal(buildPath('/', 'images'), '/images');
  assert.equal(buildPath('/root', 'album'), '/root/album');
  assert.equal(buildPath('/root', 'a/b\\c'), '/root/abc');
});

test('validateTokenInput 校验最小输入', () => {
  const result = validateTokenInput({
    name: 'CI Token',
    permissions: ['upload:image']
  });

  assert.equal(result.name, 'CI Token');
  assert.deepEqual(result.permissions, ['upload:image']);
});

test('createTokenRecord 生成可入库结构', () => {
  const record = createTokenRecord(
    {
      name: 'Deploy Token',
      permissions: ['upload:image'],
      expiresAt: null,
    },
    'ib_xxx.secret',
    'ib_xxx',
    'hashed-token',
    () => 'tok_fixedid'
  );

  assert.equal(record.id, 'tok_fixedid');
  assert.equal(record.name, 'Deploy Token');
  assert.equal(record.token_prefix, 'ib_xxx');
  assert.equal(record.token_hash, 'hashed-token');
  assert.equal(record.status, 'active');
});

test('createFilesError 生成带 status 的异常对象', () => {
  const err = createFilesError(403, 'forbidden');
  assert.equal(err.status, 403);
  assert.equal(err.message, 'forbidden');
});

test('buildQuotaEvent 生成稳定的幂等键与增量结构', () => {
  const event = buildQuotaEvent({
    operationId: 'op-1',
    fileId: 'file-1',
    storageId: 'local-main',
    eventType: 'upload',
    bytesDelta: 123,
    fileCountDelta: 1,
  });

  assert.equal(event.operation_id, 'op-1');
  assert.equal(event.storage_id, 'local-main');
  assert.equal(event.bytes_delta, 123);
  assert.equal(event.file_count_delta, 1);
  assert.equal(event.idempotency_key, 'op-1:upload:local-main:file-1');
});

test('normalizeErrorMessage 在 Error 与普通值之间统一输出文本', () => {
  assert.equal(normalizeErrorMessage(new Error('boom')), 'boom');
  assert.equal(normalizeErrorMessage('plain'), 'plain');
});

test('后端测试入口已加载', () => {
  assert.ok(true);
});

test('normalizeProxyUrl 正确解析代理地址', () => {
  const normalized = normalizeProxyUrl('http://user:pass@127.0.0.1:7890');
  assert.equal(normalized.protocol, 'http:');
  assert.equal(normalized.hostname, '127.0.0.1');
  assert.equal(normalized.port, '7890');
  assert.equal(normalized.username, 'user');
  assert.equal(normalized.password, 'pass');
});

test('fetchWithProxy 通过 dispatcher 透传代理对象', async () => {
  let capturedUrl = null;
  let capturedOptions = null;

  class MockProxyAgent {
    constructor(url) {
      this.url = url;
    }
  }

  __setDepsForTest({
    fetch: async (url, options) => {
      capturedUrl = url;
      capturedOptions = options;
      return { ok: true, status: 200 };
    },
    ProxyAgent: MockProxyAgent,
  });

  await fetchWithProxy('https://example.com', { method: 'GET' }, 'http://127.0.0.1:7890');

  assert.equal(capturedUrl, 'https://example.com');
  assert.equal(capturedOptions.method, 'GET');
  assert.ok(capturedOptions.dispatcher instanceof MockProxyAgent);
  assert.equal(capturedOptions.dispatcher.url, 'http://127.0.0.1:7890/');

  __resetDepsForTest();
});
