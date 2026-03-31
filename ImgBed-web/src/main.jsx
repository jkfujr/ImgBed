import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { ThemeProvider, createTheme, CssBaseline } from '@mui/material';

import Layout from './layout/MainLayout';
import HomePage from './pages/HomePage';
import LoginPage from './pages/LoginPage';
import AdminDashboard from './pages/admin/AdminDashboard';
import FilesAdmin from './pages/admin/FilesAdmin';
import { AuthProvider, useAuth } from './contexts/AuthContext';

// 极简冷峻蓝色 Mui 风格
const theme = createTheme({
    palette: {
      mode: 'light', // TODO 可以以后跟随系统
      primary: {
        main: '#1976d2',
      },
      secondary: {
        main: '#9c27b0',
      },
      background: {
        default: '#f5f7fa',
      }
    },
    typography: {
      fontFamily: '"Roboto", "Helvetica", "Arial", sans-serif',
      button: {
         textTransform: 'none', // 取消全角大写以保证简朴
      }
    },
});

/**
 * 后台门禁路由组件：
 * 如果未能读出挂载的认证身份则回弹到 /login
 */
function RequireAuth({ children }) {
    const { isAuthenticated, loading } = useAuth();
    if (loading) return <div>校验授权中...</div>; // 简单的阻退层
    if (!isAuthenticated) return <Navigate to="/login" replace />;
    return children;
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <AuthProvider>
          <BrowserRouter>
              <Routes>
                  {/* 使用公共主导航框架的方法挂载 */}
                  <Route path="/" element={<Layout />}>
                      <Route index element={<HomePage />} />
                      <Route path="/login" element={<LoginPage />} />
                      {/* 后台页面区 */}
                      <Route path="/admin" element={
                          <RequireAuth>
                              <AdminDashboard />
                          </RequireAuth>
                      }>
                           <Route index element={<Navigate to="files" replace />} />
                           <Route path="files" element={<FilesAdmin />} />
                           <Route path="settings" element={<div>开发中...</div>} />
                      </Route>
                      <Route path="*" element={<Navigate to="/" replace/>} />
                  </Route>
              </Routes>
          </BrowserRouter>
      </AuthProvider>
    </ThemeProvider>
  </React.StrictMode>
);
