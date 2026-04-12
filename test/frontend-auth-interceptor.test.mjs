import { strict as assert } from 'node:assert';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT = path.resolve('F:/Code/code/0x10_fork/ImgBed');
const apiModuleUrl = pathToFileURL(path.join(ROOT, 'ImgBed-web', 'src', 'api.js')).href;

function createStorage(initial = {}) {
  const store = new Map(Object.entries(initial));
  return {
    getItem(key) {
      return store.has(key) ? store.get(key) : null;
    },
    setItem(key, value) {
      store.set(key, String(value));
    },
    removeItem(key) {
      store.delete(key);
    },
    clear() {
      store.clear();
    },
  };
}

async function loadApiModule({ localStorage, sessionStorage, pathname = '/admin/files' }) {
  globalThis.localStorage = localStorage;
  globalThis.sessionStorage = sessionStorage;
  globalThis.window = {
    location: {
      pathname,
      href: pathname,
    },
  };

  return import(`${apiModuleUrl}?t=${Date.now()}-${Math.random()}`);
}

async function testAuthMissingDoesNotClearCurrentToken() {
  const localStorage = createStorage({ token: 'current-token' });
  const sessionStorage = createStorage();
  const { api } = await loadApiModule({ localStorage, sessionStorage });
  const rejectResponse = api.interceptors.response.handlers[0].rejected;

  await assert.rejects(
    () => rejectResponse({
      response: {
        status: 401,
        data: {
          code: 401,
          reason: 'AUTH_MISSING',
          message: '未授权：缺少有效的 Bearer 令牌',
        },
      },
      config: {
        headers: {
          Authorization: 'Bearer current-token',
        },
      },
    }),
  );

  assert.equal(localStorage.getItem('token'), 'current-token');
  assert.equal(sessionStorage.getItem('auth.session_invalid_notice'), null);
  assert.equal(globalThis.window.location.href, '/admin/files');
  console.log('  [OK] frontend auth interceptor: AUTH_MISSING does not clear current token');
}

async function testStaleUnauthorizedResponseDoesNotClearNewToken() {
  const localStorage = createStorage({ token: 'old-token' });
  const sessionStorage = createStorage();
  const { api } = await loadApiModule({ localStorage, sessionStorage, pathname: '/admin/channels' });
  const requestConfig = await api.interceptors.request.handlers[0].fulfilled({ headers: {} });
  const rejectResponse = api.interceptors.response.handlers[0].rejected;

  localStorage.setItem('token', 'new-token');

  await assert.rejects(
    () => rejectResponse({
      response: {
        status: 401,
        data: {
          code: 401,
          reason: 'AUTH_SESSION_INVALID',
          message: '登录态已失效，请重新登录',
        },
      },
      config: requestConfig,
    }),
  );

  assert.equal(localStorage.getItem('token'), 'new-token');
  assert.equal(sessionStorage.getItem('auth.session_invalid_notice'), null);
  assert.equal(globalThis.window.location.href, '/admin/channels');
  console.log('  [OK] frontend auth interceptor: stale 401 does not clear newer token');
}

async function testMatchingSessionInvalidResponseClearsTokenAndStoresNotice() {
  const localStorage = createStorage({ token: 'active-token' });
  const sessionStorage = createStorage();
  const { api } = await loadApiModule({ localStorage, sessionStorage, pathname: '/admin/system' });
  const requestConfig = await api.interceptors.request.handlers[0].fulfilled({ headers: {} });
  const rejectResponse = api.interceptors.response.handlers[0].rejected;

  await assert.rejects(
    () => rejectResponse({
      response: {
        status: 401,
        data: {
          code: 401,
          reason: 'AUTH_SESSION_INVALID',
          message: '登录态已失效，请重新登录',
        },
      },
      config: requestConfig,
    }),
  );

  assert.equal(localStorage.getItem('token'), null);
  assert.equal(sessionStorage.getItem('auth.session_invalid_notice'), '登录态已失效，请重新登录');
  assert.equal(globalThis.window.location.href, '/login');
  console.log('  [OK] frontend auth interceptor: matching session invalid response clears token and stores notice');
}

async function main() {
  console.log('running frontend-auth-interceptor tests...');
  await testAuthMissingDoesNotClearCurrentToken();
  await testStaleUnauthorizedResponseDoesNotClearNewToken();
  await testMatchingSessionInvalidResponseClearsTokenAndStoresNotice();
  console.log('frontend-auth-interceptor tests passed');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
