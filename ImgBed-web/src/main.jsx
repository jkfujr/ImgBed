import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { ThemeProvider, createTheme, CssBaseline } from '@mui/material';

import Layout from './layout/MainLayout';
import HomePage from './pages/HomePage';
import LoginPage from './pages/LoginPage';
import AdminDashboard from './pages/admin/AdminDashboard';
import FilesAdmin from './pages/admin/FilesAdmin';
import SettingsPage from './pages/admin/SettingsPage';
import SystemPage from './pages/admin/SystemPage';
import StorageChannelsPage from './pages/admin/StorageChannelsPage';
import { AuthProvider } from './contexts/AuthProvider';
import { RefreshProvider } from './contexts/RefreshContext';
import RequireAuth from './components/RequireAuth';

// 主题配置
const theme = createTheme({
    palette: {
      mode: 'light',
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
         textTransform: 'none',
      }
    },
});

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <AuthProvider>
        <RefreshProvider>
          <BrowserRouter>
              <Routes>
                  {/* 公共布局 */}
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
                           <Route path="settings" element={<SettingsPage />} />
                           <Route path="channels" element={<StorageChannelsPage />} />
                           <Route path="system" element={<SystemPage />} />
                      </Route>
                      <Route path="*" element={<Navigate to="/" replace/>} />
                  </Route>
              </Routes>
          </BrowserRouter>
        </RefreshProvider>
      </AuthProvider>
    </ThemeProvider>
  </React.StrictMode>
);
