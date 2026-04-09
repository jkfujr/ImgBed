import axios from 'axios';
import { ErrorResponse, ErrorCode, getErrorResponseByCode, createEnhancedError } from './utils/response.js';

// 基础 Axios 实例
export const api = axios.create({
  timeout: 60000,
});

// 请求拦截器：附带认证令牌
api.interceptors.request.use(
  (config) => {
    const token = localStorage.getItem('token');
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
  },
  (error) => {
    return Promise.reject(error);
  }
);

// 响应拦截器：处理认证失效及全局错误
api.interceptors.response.use(
  (response) => {
    return response.data;
  },
  (error) => {
    // 处理 401 授权失效
    if (error.response && error.response.status === 401) {
      localStorage.removeItem('token');
      if (window.location.pathname.startsWith('/admin')) {
        window.location.href = '/login';
      }
      // 确保 401 错误始终有正确的错误消息（防御性编程）
      if (!error.response.data) {
        error.response.data = ErrorResponse.UNAUTHORIZED;
      }
      return Promise.reject(error);
    }

    // 如果有后端响应，直接返回
    if (error.response?.data) {
      return Promise.reject(error);
    }

    // 处理网络错误：没有响应对象
    let errorResponse;

    if (error.code === ErrorCode.ERR_NETWORK || error.message === 'Network Error') {
      errorResponse = ErrorResponse.NETWORK_ERROR;
    } else if (error.code === ErrorCode.ECONNABORTED || error.code === ErrorCode.ERR_CONNECTION_ABORTED) {
      errorResponse = ErrorResponse.CONNECTION_ABORTED;
    } else {
      errorResponse = {
        code: 0,
        message: error.message || ErrorResponse.GENERIC_ERROR.message
      };
    }

    // 构造统一的错误响应格式
    return Promise.reject(createEnhancedError(errorResponse.message, errorResponse.code));
  }
);

// 接口定义
export const AuthDocs = {
   login: (data) => api.post('/api/auth/login', data),
   me: () => api.get('/api/auth/me'),
   logout: () => api.post('/api/auth/logout'),
   changePassword: (payload) => api.put('/api/auth/password', payload)
};

export const ApiTokenDocs = {
   list: () => api.get('/api/api-tokens'),
   create: (payload) => api.post('/api/api-tokens', payload),
   remove: (id) => api.delete(`/api/api-tokens/${id}`)
};

export const FileDocs = {
   list: (params) => api.get('/api/files', { params }),
   update: (id, payload) => api.put(`/api/files/${id}`, payload),
   delete: (id, deleteMode) => api.delete(`/api/files/${id}`, {
     params: deleteMode ? { delete_mode: deleteMode } : undefined,
   }),
   batch: (payload) => api.post('/api/files/batch', payload)
};

export const DirectoryDocs = {
   list: (params) => api.get('/api/directories', { params }),
   create: (payload) => api.post('/api/directories', payload),
   findByPath: async (path) => {
     const res = await api.get('/api/directories', { params: { type: 'flat' } });
     if (res.code === 0) {
       const dirs = res.data.list || res.data || [];
       return dirs.find(d => d.path === path) || null;
     }
     return null;
   }
};

export const UploadDocs = {
  /**
   * 上传单个文件
   * @param {File} file - 文件对象
   * @param {Object} options - 可选参数
   * @param {string} options.directory - 目标目录
   * @param {string} options.channel - 指定渠道
   * @param {string} options.tags - 标签（逗号分隔）
   * @param {boolean} options.is_public - 是否公开
   * @param {string} options.uploadPassword - 访客上传密码
   * @param {Function} options.onUploadProgress - 上传进度回调
   */
  upload: (file, options = {}) => {
    const formData = new FormData();
    formData.append('file', file);
    formData.append('directory', options.directory);

    if (options.channel) formData.append('channel', options.channel);
    if (options.tags) formData.append('tags', options.tags);
    if (options.is_public !== undefined) formData.append('is_public', options.is_public);

    const headers = { 'Content-Type': 'multipart/form-data' };

    // 如果提供了上传密码，添加到请求头
    if (options.uploadPassword) {
      headers['X-Upload-Password'] = options.uploadPassword;
    }

    return api.post('/api/upload', formData, {
      headers,
      onUploadProgress: options.onUploadProgress
    });
  }
};

export const StorageDocs = {
  list:       ()         => api.get('/api/system/storages'),
  stats:      ()         => api.get('/api/system/storages/stats'),
  create:     (data)     => api.post('/api/system/storages', data),
  update:     (id, data) => api.put(`/api/system/storages/${id}`, data),
  remove:     (id)       => api.delete(`/api/system/storages/${id}`),
  setDefault: (id)       => api.put(`/api/system/storages/${id}/default`),
  toggle:     (id)       => api.put(`/api/system/storages/${id}/toggle`),
  test:       (data)     => api.post('/api/system/storages/test', data),
  getLoadBalance:    ()    => api.get('/api/system/load-balance'),
  updateLoadBalance: (data) => api.put('/api/system/load-balance', data),
};

export const SystemConfigDocs = {
  get:        ()     => api.get('/api/system/config'),
  update:     (data) => api.put('/api/system/config', data),
  quotaStats: ()     => api.get('/api/system/quota-stats'),
  cacheStats: ()     => api.get('/api/system/cache/stats'),
};

export const DashboardAPI = {
  getOverview: () => api.get('/api/system/dashboard/overview'),
  getUploadTrend: (days = 7) => api.get('/api/system/dashboard/upload-trend', { params: { days } }),
  getAccessStats: () => api.get('/api/system/dashboard/access-stats'),
};

export const PublicAPI = {
  getGuestUploadConfig: () => api.get('/api/public/guest-upload-config'),
};

// 导出默认实例
export default api;
