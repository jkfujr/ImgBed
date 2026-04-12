import { strict as assert } from 'node:assert';

import {
  loadStartupConfig,
  readRuntimeConfig,
  writeRuntimeConfig,
} from '../ImgBed/src/config/index.js';

function createRequest(authorization) {
  return {
    auth: null,
    user: null,
    ip: '127.0.0.1',
    get(name) {
      const normalized = String(name || '').toLowerCase();
      if (normalized === 'authorization') {
        return authorization || null;
      }
      return null;
    },
  };
}

function createResponse() {
  return {
    statusCode: null,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    },
  };
}

async function invokeAdminAuth(authorization) {
  const { adminAuth } = await import('../ImgBed/src/middleware/auth.js');
  const req = createRequest(authorization);
  const res = createResponse();
  let nextCalled = false;

  await adminAuth(req, res, () => {
    nextCalled = true;
  });

  return { req, res, nextCalled };
}

async function testMissingBearerTokenReturnsAuthMissing() {
  const { res, nextCalled } = await invokeAdminAuth(null);

  assert.equal(nextCalled, false);
  assert.equal(res.statusCode, 401);
  assert.deepEqual(res.body, {
    code: 401,
    reason: 'AUTH_MISSING',
    message: '未授权：缺少有效的 Bearer 令牌',
  });
  console.log('  [OK] auth middleware: missing bearer token returns AUTH_MISSING');
}

async function testNonAdminJwtReturnsAuthRoleInvalid() {
  const { signToken } = await import('../ImgBed/src/utils/jwt.js');
  const token = await signToken({
    role: 'viewer',
    username: 'viewer',
  });

  const { res, nextCalled } = await invokeAdminAuth(`Bearer ${token}`);

  assert.equal(nextCalled, false);
  assert.equal(res.statusCode, 401);
  assert.deepEqual(res.body, {
    code: 401,
    reason: 'AUTH_ROLE_INVALID',
    message: '鉴权失败：需要管理员身份',
  });
  console.log('  [OK] auth middleware: non-admin jwt returns AUTH_ROLE_INVALID');
}

async function testMalformedJwtReturnsSessionInvalid() {
  const { res, nextCalled } = await invokeAdminAuth('Bearer not.a.jwt');

  assert.equal(nextCalled, false);
  assert.equal(res.statusCode, 401);
  assert.deepEqual(res.body, {
    code: 401,
    reason: 'AUTH_SESSION_INVALID',
    message: '登录态已失效，请重新登录',
  });
  console.log('  [OK] auth middleware: malformed jwt returns AUTH_SESSION_INVALID');
}

async function testExpiredJwtReturnsSessionInvalid() {
  const originalConfig = structuredClone(readRuntimeConfig());

  try {
    const nextConfig = structuredClone(originalConfig);
    nextConfig.jwt.expiresIn = '1s';
    writeRuntimeConfig(nextConfig);

    const { signToken } = await import('../ImgBed/src/utils/jwt.js');
    const token = await signToken({
      role: 'admin',
      username: 'admin',
    });

    await new Promise((resolve) => setTimeout(resolve, 1100));

    const { res, nextCalled } = await invokeAdminAuth(`Bearer ${token}`);

    assert.equal(nextCalled, false);
    assert.equal(res.statusCode, 401);
    assert.deepEqual(res.body, {
      code: 401,
      reason: 'AUTH_SESSION_INVALID',
      message: '登录态已失效，请重新登录',
    });
    console.log('  [OK] auth middleware: expired jwt returns AUTH_SESSION_INVALID');
  } finally {
    writeRuntimeConfig(originalConfig);
  }
}

async function testSecretRotationInvalidatesOldToken() {
  const originalConfig = structuredClone(readRuntimeConfig());
  const { signToken } = await import('../ImgBed/src/utils/jwt.js');
  const oldToken = await signToken({
    role: 'admin',
    username: 'admin',
  });

  try {
    const nextConfig = structuredClone(originalConfig);
    nextConfig.jwt.secret = 'rotated-secret-for-auth-middleware-test';
    writeRuntimeConfig(nextConfig);

    const { res, nextCalled } = await invokeAdminAuth(`Bearer ${oldToken}`);

    assert.equal(nextCalled, false);
    assert.equal(res.statusCode, 401);
    assert.deepEqual(res.body, {
      code: 401,
      reason: 'AUTH_SESSION_INVALID',
      message: '登录态已失效，请重新登录',
    });
    console.log('  [OK] auth middleware: secret rotation invalidates old jwt sessions');
  } finally {
    writeRuntimeConfig(originalConfig);
  }
}

async function main() {
  console.log('running auth-middleware tests...');
  loadStartupConfig();
  const { initSchema } = await import('../ImgBed/src/database/schema.js');
  const { sqlite } = await import('../ImgBed/src/database/index.js');
  initSchema(sqlite);
  await testMissingBearerTokenReturnsAuthMissing();
  await testNonAdminJwtReturnsAuthRoleInvalid();
  await testMalformedJwtReturnsSessionInvalid();
  await testExpiredJwtReturnsSessionInvalid();
  await testSecretRotationInvalidatesOldToken();
  console.log('auth-middleware tests passed');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
