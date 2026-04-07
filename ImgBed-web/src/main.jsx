/* eslint-disable react-refresh/only-export-components */
import { StrictMode, Suspense, lazy, useMemo } from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { Box, CircularProgress, ThemeProvider, createTheme, CssBaseline } from '@mui/material';

import Layout from './layout/MainLayout';
import { AuthProvider } from './contexts/AuthProvider';
import { RefreshProvider } from './contexts/RefreshContext';
import { ThemeProvider as CustomThemeProvider, useThemeMode } from './contexts/ThemeContext';
import RequireAuth from './components/RequireAuth';

const HomePage = lazy(() => import('./pages/HomePage'));
const LoginPage = lazy(() => import('./pages/LoginPage'));
const AdminDashboard = lazy(() => import('./pages/admin/AdminDashboard'));
const DashboardPage = lazy(() => import('./pages/admin/DashboardPage'));
const FilesAdmin = lazy(() => import('./pages/admin/FilesAdmin'));
const SettingsPage = lazy(() => import('./pages/admin/SettingsPage'));
const SystemPage = lazy(() => import('./pages/admin/SystemPage'));
const StorageChannelsPage = lazy(() => import('./pages/admin/StorageChannelsPage'));

const routeFallback = (
  <Box sx={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
    <CircularProgress />
  </Box>
);

// 主题配置工厂函数
const createAppTheme = (mode) => createTheme({
    palette: {
      mode,
      primary: {
        main: '#1976d2',
      },
      secondary: {
        main: '#9c27b0',
      },
      background: {
        default: mode === 'light' ? '#f5f7fa' : '#121212',
      }
    },
    typography: {
      fontFamily: '"Roboto", "Helvetica", "Arial", sans-serif',
      button: {
         textTransform: 'none',
      }
    },
});

// 应用主题包装器
function AppWithTheme() {
  const { actualMode } = useThemeMode();
  const theme = useMemo(() => createAppTheme(actualMode), [actualMode]);

  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <AuthProvider>
        <RefreshProvider>
          <BrowserRouter>
            <Suspense fallback={routeFallback}>
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
                           <Route index element={<Navigate to="dashboard" replace />} />
                           <Route path="dashboard" element={<DashboardPage />} />
                           <Route path="files" element={<FilesAdmin />} />
                           <Route path="settings" element={<SettingsPage />} />
                           <Route path="channels" element={<StorageChannelsPage />} />
                           <Route path="system" element={<SystemPage />} />
                      </Route>
                      <Route path="*" element={<Navigate to="/" replace/>} />
                  </Route>
              </Routes>
            </Suspense>
          </BrowserRouter>
        </RefreshProvider>
      </AuthProvider>
    </ThemeProvider>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <StrictMode>
    <CustomThemeProvider>
      <AppWithTheme />
    </CustomThemeProvider>
  </StrictMode>
);
