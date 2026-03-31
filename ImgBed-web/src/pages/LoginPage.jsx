import React, { useState } from 'react';
import { Box, Paper, Typography, TextField, Button, CircularProgress, Alert } from '@mui/material';
import LockOutlinedIcon from '@mui/icons-material/LockOutlined';
import { useAuth } from '../contexts/AuthContext';
import { useNavigate } from 'react-router-dom';

export default function LoginPage() {
  const { login } = useAuth();
  const navigate = useNavigate();
  
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      // 提交用户名和密码
      await login({ username, password });
      navigate('/admin/files'); 
    } catch (err) {
      setError(err.message || '登录失败，请检查用户名或密码');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Box sx={{ flexGrow: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <Paper elevation={3} sx={{ p: 5, maxWidth: 400, width: '100%', borderRadius: 3 }}>
        <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', mb: 4 }}>
           <Box sx={{ m: 1, bgcolor: 'secondary.main', p: 1, borderRadius: '50%', color: 'white', display: 'flex', alignItems: 'center' }}>
              <LockOutlinedIcon />
           </Box>
           <Typography component="h1" variant="h5" fontWeight="bold">
              管理后台
           </Typography>
        </Box>

        {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}

        <form onSubmit={handleSubmit} style={{ width: '100%' }}>
          <TextField
              variant="outlined"
              margin="normal"
              required
              fullWidth
              label="用户名"
              name="username"
              autoFocus
              value={username}
              onChange={(e) => setUsername(e.target.value)}
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
              onChange={(e) => setPassword(e.target.value)}
              disabled={loading}
          />
          <Button
              type="submit"
              fullWidth
              variant="contained"
              color="primary"
              size="large"
              disabled={loading}
              sx={{ mt: 3, mb: 2, borderRadius: 2, py: 1.5 }}
          >
              {loading ? <CircularProgress size={24} color="inherit" /> : '登录'}
          </Button>
          <Box sx={{ mt: 2, textAlign: 'center' }}>
            <Typography variant="caption" color="text.secondary">
              初始凭据: admin / admin
            </Typography>
          </Box>
        </form>
      </Paper>
    </Box>
  );
}
