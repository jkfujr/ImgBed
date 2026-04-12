export const AUTH_REASON_MISSING = 'AUTH_MISSING';
export const AUTH_REASON_ROLE_INVALID = 'AUTH_ROLE_INVALID';
export const AUTH_REASON_SESSION_INVALID = 'AUTH_SESSION_INVALID';
export const AUTH_SESSION_INVALID_NOTICE_KEY = 'auth.session_invalid_notice';
export const AUTH_SESSION_INVALID_MESSAGE = '登录态已失效，请重新登录';

let activeSessionToken = null;
let sessionInvalidationHandler = null;

export function setActiveSessionToken(token) {
  activeSessionToken = token || null;
}

export function getActiveSessionToken() {
  return activeSessionToken;
}

export function readStoredAuthToken(localStorageImpl = globalThis.localStorage) {
  return localStorageImpl?.getItem('token') || null;
}

export function writeStoredAuthToken(token, localStorageImpl = globalThis.localStorage) {
  if (!localStorageImpl) {
    return;
  }

  if (token) {
    localStorageImpl.setItem('token', token);
    return;
  }

  localStorageImpl.removeItem('token');
}

export function markAuthRequest(config, token = readStoredAuthToken()) {
  const nextConfig = config;
  const headers = nextConfig.headers || {};

  nextConfig.headers = headers;
  nextConfig.__authTokenSnapshot = token || null;

  if (token) {
    headers.Authorization = `Bearer ${token}`;
  } else if ('Authorization' in headers) {
    delete headers.Authorization;
  }

  return nextConfig;
}

export function shouldApplySessionCheck({
  requestVersion,
  activeVersion,
  requestToken,
  activeToken,
}) {
  return requestVersion === activeVersion && requestToken === activeToken;
}

export function shouldInvalidateSessionFromResponse({
  status,
  payload,
  requestToken,
  activeToken = getActiveSessionToken() || readStoredAuthToken(),
}) {
  return (
    status === 401 &&
    payload?.reason === AUTH_REASON_SESSION_INVALID &&
    Boolean(requestToken) &&
    requestToken === activeToken
  );
}

export function storeSessionInvalidationNotice(
  message = AUTH_SESSION_INVALID_MESSAGE,
  sessionStorageImpl = globalThis.sessionStorage,
) {
  sessionStorageImpl?.setItem(AUTH_SESSION_INVALID_NOTICE_KEY, message || AUTH_SESSION_INVALID_MESSAGE);
}

export function consumeSessionInvalidationNotice(sessionStorageImpl = globalThis.sessionStorage) {
  const message = sessionStorageImpl?.getItem(AUTH_SESSION_INVALID_NOTICE_KEY) || null;
  if (message) {
    sessionStorageImpl.removeItem(AUTH_SESSION_INVALID_NOTICE_KEY);
  }
  return message;
}

export function isAdminPath(pathname) {
  return String(pathname || '').startsWith('/admin');
}

export function applySessionInvalidationFallback({
  message = AUTH_SESSION_INVALID_MESSAGE,
  shouldRedirect = false,
  localStorageImpl = globalThis.localStorage,
  sessionStorageImpl = globalThis.sessionStorage,
  locationObj = globalThis.window?.location,
} = {}) {
  writeStoredAuthToken(null, localStorageImpl);
  setActiveSessionToken(null);
  storeSessionInvalidationNotice(message, sessionStorageImpl);

  if (shouldRedirect && locationObj) {
    locationObj.href = '/login';
  }
}

export function setSessionInvalidationHandler(handler) {
  sessionInvalidationHandler = handler;
  return () => {
    if (sessionInvalidationHandler === handler) {
      sessionInvalidationHandler = null;
    }
  };
}

export function notifySessionInvalidation(context) {
  if (typeof sessionInvalidationHandler === 'function') {
    return sessionInvalidationHandler(context);
  }

  return false;
}
