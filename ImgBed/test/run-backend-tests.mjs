import test from 'node:test';
import assert from 'node:assert/strict';

import { parsePermissions, normalizePermissions, hashApiToken } from '../src/utils/apiToken.js';
import { buildPath } from '../src/services/directories/directory-operations.js';
import { validateTokenInput, createTokenRecord } from '../src/services/api-tokens/create-token.js';
import { createFilesError } from '../src/services/files/migrate-file.js';

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

test('后端测试入口已加载', () => {
  assert.ok(true);
});
