import axios from 'axios';

// 基础 Axios 实例 (用于跨域及自动拼接域名)
export const api = axios.create({
  timeout: 60000,
});

// 请求拦截器：当处于登录状态时自动在 Header 附带 Token
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

// 响应拦截器：处理失效 Token 或拦截全局错误
api.interceptors.response.use(
  (response) => {
    return response.data;
  },
  (error) => {
    if (error.response && error.response.status === 401) {
       // 探测到 Unauthorized 时主动销毁前端状态，跳转到 /login交由 router 决定较合适
       localStorage.removeItem('token');
       if (window.location.pathname.startsWith('/admin')) {
           window.location.href = '/login';
       }
    }
    return Promise.reject(error);
  }
);

// 具体接口的快速捆绑
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

// 暴露主实例以供直接调用，如 file upload
export default api;
