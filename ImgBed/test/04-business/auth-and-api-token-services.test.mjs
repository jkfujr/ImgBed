import assert from 'node:assert/strict';
import test from 'node:test';

import { verifyAdminCredentials } from '../../src/services/auth/verify-credentials.js';
import { hashAdminPassword } from '../../src/utils/admin-password.js';
import {
  createTempAppRoot,
  resolveProjectModuleUrl,
} from '../helpers/runtime-test-helpers.mjs';

const appRoot = createTempAppRoot('imgbed-04-auth-');
process.env.IMGBED_APP_ROOT = appRoot;

const configModule = await import(resolveProjectModuleUrl('src', 'config', 'index.js'));
configModule.loadStartupConfig();

const { validateTokenInput, createTokenRecord } = await import(resolveProjectModuleUrl('src', 'services', 'api-tokens', 'create-token.js'));
const apiTokenUtils = await import(resolveProjectModuleUrl('src', 'utils', 'apiToken.js'));

test('verifyAdminCredentials 支持哈希密码并兼容旧版明文配置', async () => {
  const hashedAdminConfig = {
    username: 'admin',
    passwordHash: hashAdminPassword('plain-password', {
      randomBytes: () => Buffer.alloc(16, 0x34),
    }),
  };
  const legacyAdminConfig = {
    username: 'admin',
    password: 'plain-password',
  };

  assert.equal(await verifyAdminCredentials('admin', 'plain-password', hashedAdminConfig), true);
  assert.equal(await verifyAdminCredentials('admin', 'wrong-password', hashedAdminConfig), false);
  assert.equal(await verifyAdminCredentials('admin', 'plain-password', legacyAdminConfig), true);
  assert.equal(await verifyAdminCredentials('admin', 'wrong-password', legacyAdminConfig), false);
  assert.equal(await verifyAdminCredentials('', 'plain-password', hashedAdminConfig), false);
});

test('validateTokenInput 会接受合法权限和未来的自定义过期时间', () => {
  const future = new Date(Date.now() + 60_000).toISOString();

  const result = validateTokenInput({
    name: '上传令牌',
    permissions: [apiTokenUtils.API_TOKEN_PERMISSIONS.UPLOAD_IMAGE],
    expiresMode: 'custom',
    expiresAt: future,
  });

  assert.equal(result.name, '上传令牌');
  assert.deepEqual(result.permissions, [apiTokenUtils.API_TOKEN_PERMISSIONS.UPLOAD_IMAGE]);
  assert.equal(result.expiresAt, new Date(future).toISOString());
});

test('validateTokenInput 会拒绝空名称、空权限和过去时间', () => {
  assert.throws(
    () => validateTokenInput({
      name: '',
      permissions: [apiTokenUtils.API_TOKEN_PERMISSIONS.UPLOAD_IMAGE],
    }),
    /Token 名称不能为空/,
  );

  assert.throws(
    () => validateTokenInput({
      name: 'empty-permissions',
      permissions: [],
    }),
    /至少选择一项权限/,
  );

  assert.throws(
    () => validateTokenInput({
      name: 'past-token',
      permissions: [apiTokenUtils.API_TOKEN_PERMISSIONS.FILES_READ],
      expiresMode: 'custom',
      expiresAt: new Date(Date.now() - 60_000).toISOString(),
    }),
    /过期时间必须晚于当前时间/,
  );
});

test('createTokenRecord 会固定写入 active 状态、admin 创建者并序列化权限列表', () => {
  const record = createTokenRecord({
    name: '文件读取令牌',
    permissions: [apiTokenUtils.API_TOKEN_PERMISSIONS.FILES_READ],
    expiresAt: null,
  }, 'ib_xxx.secret', 'ib_xxx', 'hashed-token', () => 'tok-fixed-id');

  assert.equal(record.id, 'tok-fixed-id');
  assert.equal(record.name, '文件读取令牌');
  assert.equal(record.token_prefix, 'ib_xxx');
  assert.equal(record.token_hash, 'hashed-token');
  assert.equal(record.permissions, JSON.stringify([apiTokenUtils.API_TOKEN_PERMISSIONS.FILES_READ]));
  assert.equal(record.status, 'active');
  assert.equal(record.expires_at, null);
  assert.equal(record.last_used_at, null);
  assert.equal(record.last_used_ip, null);
  assert.equal(record.created_by, 'admin');
  assert.match(record.created_at, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  assert.match(record.updated_at, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  assert.equal(record.created_at, record.updated_at);
});
