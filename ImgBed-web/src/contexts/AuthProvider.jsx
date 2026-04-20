import { useCallback, useEffect, useRef, useState } from 'react';
import { AuthDocs, api } from '../api';
import {
  applySessionInvalidationFallback,
  AUTH_REASON_SESSION_INVALID,
  readStoredAuthToken,
  setActiveSessionToken,
  setSessionInvalidationHandler,
  shouldApplySessionCheck,
  writeStoredAuthToken,
} from '../auth/session.js';
import {
  AUTH_PROBE_ACTION_INVALIDATE,
  getBootstrapAuthState,
  resolveAuthProbeFailureAction,
} from '../auth/auth-session-state.js';
import { AuthContext } from '../hooks/useAuth';

export const AuthProvider = ({ children }) => {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const sessionVersionRef = useRef(0);
  const activeTokenRef = useRef(null);

  const syncActiveSessionToken = useCallback((token) => {
    const normalizedToken = token || null;
    activeTokenRef.current = normalizedToken;
    setActiveSessionToken(normalizedToken);
    writeStoredAuthToken(normalizedToken);

    if (normalizedToken) {
      api.defaults.headers.common.Authorization = `Bearer ${normalizedToken}`;
      return;
    }

    delete api.defaults.headers.common.Authorization;
  }, []);

  const invalidateSession = useCallback(({
    reason = null,
    requestToken = null,
    message = null,
    shouldRedirect = false,
    storeNotice = reason === AUTH_REASON_SESSION_INVALID,
  } = {}) => {
    const currentToken = activeTokenRef.current;

    if (requestToken && currentToken && requestToken !== currentToken) {
      return false;
    }

    sessionVersionRef.current += 1;
    syncActiveSessionToken(null);
    setIsAuthenticated(false);
    setUser(null);
    setLoading(false);

    if (storeNotice || shouldRedirect) {
      applySessionInvalidationFallback({
        message,
        shouldRedirect,
      });
    }

    return true;
  }, [syncActiveSessionToken]);

  const canApplySessionResult = useCallback(({ token, version }) => {
    return shouldApplySessionCheck({
      requestVersion: version,
      activeVersion: sessionVersionRef.current,
      requestToken: token,
      activeToken: activeTokenRef.current,
    });
  }, []);

  const checkLoginState = useCallback(async ({ token, version }) => {
    if (!token) {
      if (canApplySessionResult({ token, version })) {
        setIsAuthenticated(false);
        setUser(null);
        setLoading(false);
      }
      return;
    }

    try {
      const res = await AuthDocs.me();
      if (!canApplySessionResult({ token, version })) {
        return;
      }

      if (res.code !== 0) {
        throw new Error(res.message || '获取登录状态失败');
      }

      setIsAuthenticated(true);
      setUser(res.data);
    } catch (error) {
      const payload = error?.response?.data;
      const action = resolveAuthProbeFailureAction({
        payloadReason: payload?.reason || null,
        requestToken: token,
        activeToken: activeTokenRef.current,
        requestVersion: version,
        activeVersion: sessionVersionRef.current,
      });

      if (action === AUTH_PROBE_ACTION_INVALIDATE) {
        invalidateSession({
          reason: payload?.reason,
          requestToken: token,
          message: payload?.message,
          shouldRedirect: false,
        });
      }
    } finally {
      if (canApplySessionResult({ token, version })) {
        setLoading(false);
      }
    }
  }, [canApplySessionResult, invalidateSession]);

  useEffect(() => {
    const cleanup = setSessionInvalidationHandler((context) => invalidateSession(context));
    return cleanup;
  }, [invalidateSession]);

  useEffect(() => {
    const token = readStoredAuthToken();
    syncActiveSessionToken(token);

    if (!token) {
      setIsAuthenticated(false);
      setUser(null);
      setLoading(false);
      return;
    }

    const bootstrapState = getBootstrapAuthState(token);
    setIsAuthenticated(bootstrapState.isAuthenticated);
    setLoading(bootstrapState.loading);

    void checkLoginState({
      token,
      version: sessionVersionRef.current,
    });
  }, [syncActiveSessionToken, checkLoginState]);

  const login = async (credentials) => {
    const res = await AuthDocs.login(credentials);
    if (res.code !== 0) {
      throw new Error(res.message);
    }

    const token = res.data?.token;
    if (!token) {
      throw new Error('登录失败：服务端未返回令牌');
    }

    sessionVersionRef.current += 1;
    syncActiveSessionToken(token);
    setIsAuthenticated(true);
    setUser({
      username: res.data?.username || credentials.username,
      role: res.data?.role || 'admin',
    });
    setLoading(false);

    void checkLoginState({
      token,
      version: sessionVersionRef.current,
    });
  };

  const logout = async () => {
    const requestToken = activeTokenRef.current;

    try {
      await AuthDocs.logout();
    } catch {
      // 服务端登出失败不影响本地会话清理，继续走本地 invalidateSession
    }

    invalidateSession({
      requestToken,
      shouldRedirect: false,
      storeNotice: false,
    });
  };

  return (
    <AuthContext.Provider value={{ isAuthenticated, user, loading, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
};
