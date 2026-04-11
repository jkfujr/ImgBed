import { strict as assert } from 'node:assert';

import { cacheMiddleware, filesListCache, dashboardUploadTrendCache } from '../ImgBed/src/middleware/cache.js';
import { initResponseCache, getResponseCache } from '../ImgBed/src/services/cache/response-cache.js';

function makeReq({
  query = {},
  auth = undefined,
  user = undefined,
  method = 'GET',
} = {}) {
  return {
    method,
    query,
    auth,
    user,
  };
}

function makeRes() {
  return {
    lastJson: undefined,
    json(data) {
      this.lastJson = data;
      return data;
    },
  };
}

async function runMiddleware(middleware, req, res) {
  let nextCalled = false;
  await middleware(req, res, () => {
    nextCalled = true;
  });
  return { nextCalled };
}

function resetCache() {
  initResponseCache({ enabled: true, ttlSeconds: 60, maxKeys: 1000 });
  return getResponseCache();
}

async function testDefaultCacheKeyIncludesAdminIdentity() {
  const cache = resetCache();
  const middleware = cacheMiddleware({ prefix: 'system:config' });

  const reqAdminA = makeReq({
    query: {},
    auth: { type: 'admin_jwt', username: 'alice' },
    user: { username: 'alice' },
  });
  const reqAdminB = makeReq({
    query: {},
    auth: { type: 'admin_jwt', username: 'bob' },
    user: { username: 'bob' },
  });

  const resA = makeRes();
  const resB = makeRes();

  await runMiddleware(middleware, reqAdminA, resA);
  resA.json({ code: 0, data: { owner: 'alice' } });

  const { nextCalled } = await runMiddleware(middleware, reqAdminB, resB);
  assert.equal(nextCalled, true, '不同管理员身份不应命中同一缓存');
  assert.equal(resB.lastJson, undefined, '未命中时中间件不应直接返回缓存响应');
  const adminAKey = Array.from(cache.cache.keys()).find((key) => key.includes('system:config') && key.includes('identity:admin_jwt:alice'));
  assert.ok(adminAKey, '应写入带管理员身份的默认缓存键');
  console.log('  [OK] 默认缓存键：管理员身份不同不会共享缓存');
}

async function testFilesListCacheSeparatesGuestAndAdmin() {
  const cache = resetCache();
  const middleware = filesListCache();

  const query = { page: '1', pageSize: '20', directory: '/', search: '' };
  const guestReq = makeReq({ auth: { type: 'guest' }, query });
  const adminReq = makeReq({ auth: { type: 'admin_jwt', username: 'root' }, user: { username: 'root' }, query });

  const guestRes = makeRes();
  const adminRes = makeRes();

  await runMiddleware(middleware, guestReq, guestRes);
  guestRes.json({ code: 0, data: { list: ['guest-data'] } });

  const guestKey = Array.from(cache.cache.keys()).find((key) => key.includes('files:list') && key.includes('identity:guest'));
  assert.ok(guestKey, '应写入带 guest 身份的文件列表缓存键');

  const { nextCalled } = await runMiddleware(middleware, adminReq, adminRes);
  assert.equal(nextCalled, true, '管理员请求不应命中访客缓存');
  assert.equal(adminRes.lastJson, undefined, '身份不同应继续走后续处理');
  console.log('  [OK] filesListCache：guest 与 admin 缓存隔离');
}

async function testDashboardUploadTrendSeparatesApiToken() {
  const cache = resetCache();
  const middleware = dashboardUploadTrendCache();

  const reqA = makeReq({ auth: { type: 'api_token', tokenId: 'token-a' }, query: { days: '7' } });
  const reqB = makeReq({ auth: { type: 'api_token', tokenId: 'token-b' }, query: { days: '7' } });

  const resA = makeRes();
  const resB = makeRes();

  await runMiddleware(middleware, reqA, resA);
  resA.json({ code: 0, data: { trend: [1, 2, 3] } });

  const keys = Array.from(cache.cache.keys()).filter((key) => key.includes('system:dashboard:upload-trend'));
  assert.equal(keys.length, 1, '第一次请求后应只存在一个上传趋势缓存键');
  assert.ok(keys[0].includes('identity:api_token:token-a'), '缓存键应包含 api token 身份');

  const { nextCalled } = await runMiddleware(middleware, reqB, resB);
  assert.equal(nextCalled, true, '不同 token 不应共享上传趋势缓存');
  assert.equal(resB.lastJson, undefined);
  console.log('  [OK] dashboardUploadTrendCache：不同 API Token 缓存隔离');
}

async function testSameIdentityHitsCache() {
  resetCache();
  const middleware = filesListCache();
  const query = { page: '1', pageSize: '20', directory: '/', search: '' };
  const req = makeReq({ auth: { type: 'guest' }, query });

  const firstRes = makeRes();
  const secondRes = makeRes();

  await runMiddleware(middleware, req, firstRes);
  firstRes.json({ code: 0, data: { list: ['cached'] } });

  const { nextCalled } = await runMiddleware(middleware, req, secondRes);
  assert.equal(nextCalled, false, '相同身份与参数应直接命中缓存');
  assert.deepEqual(secondRes.lastJson, { code: 0, data: { list: ['cached'] } });
  console.log('  [OK] 相同身份：可正常命中缓存');
}

async function main() {
  console.log('开始测试缓存键身份隔离...');
  await testDefaultCacheKeyIncludesAdminIdentity();
  await testFilesListCacheSeparatesGuestAndAdmin();
  await testDashboardUploadTrendSeparatesApiToken();
  await testSameIdentityHitsCache();
  console.log('缓存键身份隔离测试全部通过');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
