import { useEffect, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  Paper,
  Tab,
  Tabs,
  TextField,
  Typography,
} from '@mui/material';
import LockOutlinedIcon from '@mui/icons-material/LockOutlined';
import KeyIcon from '@mui/icons-material/Key';
import { useNavigate, useLocation } from 'react-router-dom';
import { consumeSessionInvalidationNotice } from '../auth/session.js';
import { useAuth } from '../hooks/useAuth';
import { BORDER_RADIUS } from '../utils/constants';

export default function LoginPage() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const searchParams = new URLSearchParams(location.search);
  const defaultTab = searchParams.get('tab') === 'admin' ? 1 : 0;

  const [tabIndex, setTabIndex] = useState(defaultTab);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [guestPassword, setGuestPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    const message = consumeSessionInvalidationNotice();
    if (message) {
      setError(message);
    }
  }, []);

  const handleAdminLogin = async (event) => {
    event.preventDefault();
    setLoading(true);
    setError(null);

    try {
      await login({ username, password });
      navigate('/admin/files');
    } catch (err) {
      setError(err.message || '登录失败，请检查用户名或密码');
    } finally {
      setLoading(false);
    }
  };

  const handleGuestPasswordSubmit = async (event) => {
    event.preventDefault();

    if (!guestPassword.trim()) {
      setError('请输入访客上传密码');
      return;
    }

    setLoading(true);
    setError(null);

    try {
      sessionStorage.setItem('uploadPassword', guestPassword.trim());
      navigate('/');
    } catch {
      setError('保存密码失败');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Box sx={{ flexGrow: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <Paper elevation={3} sx={{ p: 5, maxWidth: 400, width: '100%', borderRadius: BORDER_RADIUS.lg }}>
        <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', mb: 3 }}>
          <Box
            sx={{
              m: 1,
              bgcolor: 'secondary.main',
              p: 1,
              borderRadius: BORDER_RADIUS.circle,
              color: 'white',
              display: 'flex',
              alignItems: 'center',
            }}
          >
            {tabIndex === 0 ? <KeyIcon /> : <LockOutlinedIcon />}
          </Box>
          <Typography component="h1" variant="h5" fontWeight="bold">
            {tabIndex === 0 ? '访客上传' : '管理后台'}
          </Typography>
        </Box>

        <Tabs
          value={tabIndex}
          onChange={(_event, newValue) => {
            setTabIndex(newValue);
            setError(null);
          }}
          variant="fullWidth"
          sx={{ mb: 3, borderBottom: 1, borderColor: 'divider' }}
        >
          <Tab label="访客密码" />
          <Tab label="管理员登录" />
        </Tabs>

        {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}

        {tabIndex === 0 ? (
          <form onSubmit={handleGuestPasswordSubmit} style={{ width: '100%' }}>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
              管理员已开启访客上传密码保护，请输入密码后继续上传
            </Typography>
            <TextField
              variant="outlined"
              margin="normal"
              required
              fullWidth
              label="访客上传密码"
              name="guestPassword"
              type="password"
              autoFocus
              value={guestPassword}
              onChange={(event) => setGuestPassword(event.target.value)}
              disabled={loading}
            />
            <Button
              type="submit"
              fullWidth
              variant="contained"
              color="primary"
              size="large"
              disabled={loading}
              sx={{ mt: 3, mb: 2, borderRadius: BORDER_RADIUS.md, py: 1.5 }}
            >
              {loading ? <CircularProgress size={24} color="inherit" /> : '确认'}
            </Button>
          </form>
        ) : (
          <form onSubmit={handleAdminLogin} style={{ width: '100%' }}>
            <TextField
              variant="outlined"
              margin="normal"
              required
              fullWidth
              label="用户名"
              name="username"
              autoFocus
              value={username}
              onChange={(event) => setUsername(event.target.value)}
              disabled={loading}
            />
            <TextField
              variant="outlined"
              margin="normal"
              required
              fullWidth
              label="密码"
              name="password"
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              disabled={loading}
            />
            <Button
              type="submit"
              fullWidth
              variant="contained"
              color="primary"
              size="large"
              disabled={loading}
              sx={{ mt: 3, mb: 2, borderRadius: BORDER_RADIUS.md, py: 1.5 }}
            >
              {loading ? <CircularProgress size={24} color="inherit" /> : '登录'}
            </Button>
          </form>
        )}
      </Paper>
    </Box>
  );
}
