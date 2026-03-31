import axios from 'axios';

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
// 响应拦截器
api.interceptors.response.use(
  (response) => {
    return response.data;
  },
  (error) => {
    if (error.response && error.response.status === 401) {
        // 授权失效时清除本地状态并跳转登录
        localStorage.removeItem('token');
        if (window.location.pathname.startsWith('/admin')) {
            window.location.href = '/login';
        }
    }
    return Promise.reject(error);
  }
);

// 接口定义
export const AuthDocs = {
   login: (data) => api.post('/api/auth/login', data),
   me: () => api.get('/api/auth/me'),
   logout: () => api.post('/api/auth/logout')
};

export const FileDocs = {
   list: (params) => api.get('/api/files', { params }),
   update: (id, payload) => api.put(`/api/files/${id}`, payload),
   delete: (id) => api.delete(`/api/files/${id}`),
   batch: (payload) => api.post('/api/files/batch', payload)
};

// 导出默认实例
export default api;
