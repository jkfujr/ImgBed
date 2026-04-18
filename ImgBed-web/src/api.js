import axios from 'axios';
import {
  applySessionInvalidationFallback,
  isAdminPath,
  markAuthRequest,
  notifySessionInvalidation,
  shouldInvalidateSessionFromResponse,
} from './auth/session.js';
import {
  ErrorResponse,
  ErrorCode,
  getErrorResponseByCode,
  createEnhancedError,
} from './utils/response.js';

export const api = axios.create({
  timeout: 60000,
});

api.interceptors.request.use(
  (config) => {
    return markAuthRequest(config);
  },
  (error) => {
    return Promise.reject(error);
  },
);

api.interceptors.response.use(
  (response) => {
    return response.data;
  },
  (error) => {
    if (error.response?.status === 401) {
      const payload = error.response.data || ErrorResponse.UNAUTHORIZED;
      const requestToken = error.config?.__authTokenSnapshot || null;
      const shouldRedirect = isAdminPath(globalThis.window?.location?.pathname);

      error.response.data = payload;

      if (shouldInvalidateSessionFromResponse({
        status: error.response.status,
        payload,
        requestToken,
      })) {
        const handled = notifySessionInvalidation({
          reason: payload.reason,
          message: payload.message,
          requestToken,
          shouldRedirect,
        });

        if (!handled) {
          applySessionInvalidationFallback({
            message: payload.message,
            shouldRedirect,
          });
        }
      }

      return Promise.reject(error);
    }

    if (error.response?.data) {
      return Promise.reject(error);
    }

    let errorResponse;

    if (error.code === ErrorCode.ERR_NETWORK || error.message === 'Network Error') {
      errorResponse = ErrorResponse.NETWORK_ERROR;
    } else {
      errorResponse = getErrorResponseByCode(error.code);
    }

    if (!errorResponse || errorResponse === ErrorResponse.GENERIC_ERROR) {
      errorResponse = {
        code: 0,
        message: error.message || ErrorResponse.GENERIC_ERROR.message,
      };
    }

    return Promise.reject(createEnhancedError(errorResponse.message, errorResponse.code));
  },
);

export const AuthDocs = {
  login: (data) => api.post('/api/auth/login', data),
  me: () => api.get('/api/auth/me'),
  logout: () => api.post('/api/auth/logout'),
  changePassword: (payload) => api.put('/api/auth/password', payload),
};

export const ApiTokenDocs = {
  list: () => api.get('/api/api-tokens'),
  create: (payload) => api.post('/api/api-tokens', payload),
  remove: (id) => api.delete(`/api/api-tokens/${id}`),
};

export const FileDocs = {
  list: (params) => api.get('/api/files', { params }),
  update: (id, payload) => api.put(`/api/files/${id}`, payload),
  delete: (id, deleteMode) => api.delete(`/api/files/${id}`, {
    params: deleteMode ? { delete_mode: deleteMode } : undefined,
  }),
  batch: (payload) => api.post('/api/files/batch', payload),
};

export const DirectoryDocs = {
  list: (params) => api.get('/api/directories', { params }),
  create: (payload) => api.post('/api/directories', payload),
  findByPath: async (path) => {
    const res = await api.get('/api/directories', { params: { type: 'flat' } });
    if (res.code === 0) {
      const dirs = res.data.list || res.data || [];
      return dirs.find((dir) => dir.path === path) || null;
    }
    return null;
  },
};

export const UploadDocs = {
  upload: (file, options = {}) => {
    const formData = new FormData();
    formData.append('file', file);
    formData.append('directory', options.directory);

    if (options.channel) formData.append('channel', options.channel);
    if (options.tags) formData.append('tags', options.tags);
    if (options.is_public !== undefined) formData.append('is_public', options.is_public);

    const headers = { 'Content-Type': 'multipart/form-data' };

    if (options.uploadPassword) {
      headers['X-Upload-Password'] = options.uploadPassword;
    }

    return api.post('/api/upload', formData, {
      headers,
      onUploadProgress: options.onUploadProgress,
    });
  },
};

export const StorageDocs = {
  list: (force = false) => api.get('/api/system/storages', {
    params: force ? { force: 'true' } : {}
  }),
  stats: (force = false) => api.get('/api/system/storages/stats', {
    params: force ? { force: 'true' } : {}
  }),
  create: (data) => api.post('/api/system/storages', data),
  update: (id, data) => api.put(`/api/system/storages/${id}`, data),
  remove: (id) => api.delete(`/api/system/storages/${id}`),
  setDefault: (id) => api.put(`/api/system/storages/${id}/default`),
  toggle: (id) => api.put(`/api/system/storages/${id}/toggle`),
  test: (data) => api.post('/api/system/storages/test', data),
  getLoadBalance: (force = false) => api.get('/api/system/load-balance', {
    params: force ? { force: 'true' } : {}
  }),
  updateLoadBalance: (data) => api.put('/api/system/load-balance', data),
};

export const SystemConfigDocs = {
  get: (force = false) => api.get('/api/system/config', {
    params: force ? { force: 'true' } : {}
  }),
  update: (data) => api.put('/api/system/config', data),
  quotaStats: (force = false) => api.get('/api/system/quota-stats', {
    params: force ? { force: 'true' } : {}
  }),
  cacheStats: (force = false) => api.get('/api/system/cache/stats', {
    params: force ? { force: 'true' } : {}
  }),
};

export const DashboardAPI = {
  getOverview: (force = false) => api.get('/api/system/dashboard/overview', {
    params: force ? { force: 'true' } : {}
  }),
  getUploadTrend: (days = 7, force = false) => api.get('/api/system/dashboard/upload-trend', {
    params: { days, ...(force ? { force: 'true' } : {}) }
  }),
  getAccessStats: (force = false) => api.get('/api/system/dashboard/access-stats', {
    params: force ? { force: 'true' } : {}
  }),
};

export const PublicAPI = {
  getGuestUploadConfig: () => api.get('/api/public/guest-upload-config'),
};

export default api;
