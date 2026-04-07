import { useState, useEffect } from 'react';
import {
  Box, Typography, Button, CircularProgress, Alert, Divider,
  FormControlLabel, Switch, TextField
} from '@mui/material';
import { SystemConfigDocs } from '../../api';
import LoadingSpinner from '../common/LoadingSpinner';

export default function SecurityConfigPanel() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState(null);
  const [guestUploadEnabled, setGuestUploadEnabled] = useState(false);
  const [uploadPassword, setUploadPassword] = useState('');
  const [initialConfig, setInitialConfig] = useState(null);

  useEffect(() => {
    const loadConfig = async () => {
      setLoading(true);
      try {
        const res = await SystemConfigDocs.get();
        if (res.code === 0) {
          const guestEnabled = res.data.security?.guestUploadEnabled || false;
          const password = res.data.security?.uploadPassword || '';

          setGuestUploadEnabled(guestEnabled);
          setUploadPassword(password);

          setInitialConfig({
            guestUploadEnabled: guestEnabled,
            uploadPassword: password,
          });
        }
      } catch {
        setResult({ type: 'error', msg: '加载配置失败，请检查网络或后端服务' });
      } finally {
        setLoading(false);
      }
    };

    loadConfig();
  }, []);

  const handleReset = () => {
    if (initialConfig) {
      setGuestUploadEnabled(initialConfig.guestUploadEnabled);
      setUploadPassword(initialConfig.uploadPassword);
      setResult(null);
    }
  };

  const handleSave = async () => {
    setResult(null);
    setSaving(true);
    try {
      const payload = {
        security: {
          guestUploadEnabled,
          uploadPassword,
        },
      };
      const res = await SystemConfigDocs.update(payload);
      if (res.code === 0) {
        setResult({ type: 'success', msg: res.message || '保存成功' });
        setInitialConfig({
          guestUploadEnabled,
          uploadPassword,
        });
      } else {
        setResult({ type: 'error', msg: res.message || '保存失败' });
      }
    } catch (err) {
      setResult({ type: 'error', msg: err.response?.data?.message || '网络错误' });
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return <LoadingSpinner fullHeight={false} />;
  }

  return (
    <Box display="flex" flexDirection="column" gap={2.5}>
      {result && (
        <Alert severity={result.type} onClose={() => setResult(null)}>{result.msg}</Alert>
      )}

      <Typography variant="subtitle1" fontWeight="bold" mb={1}>
        访客上传
      </Typography>

      <FormControlLabel
        control={
          <Switch
            checked={guestUploadEnabled}
            onChange={(e) => setGuestUploadEnabled(e.target.checked)}
          />
        }
        label="允许访客上传"
      />
      <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: -1.5 }}>
        开启后，未登录用户可以上传文件，但无法访问管理后台
      </Typography>

      {guestUploadEnabled && (
        <>
          <Divider sx={{ my: 1 }} />

          <Typography variant="subtitle1" fontWeight="bold" mb={1}>
            上传密码
          </Typography>

          <TextField
            label="上传密码"
            size="small"
            type="password"
            value={uploadPassword}
            onChange={(e) => setUploadPassword(e.target.value)}
            placeholder="留空表示无需密码"
            sx={{ maxWidth: 400 }}
          />
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: -1.5 }}>
            设置密码后，访客上传前需要先验证密码。留空表示无需密码验证
          </Typography>
        </>
      )}

      <Box sx={{ display: 'flex', gap: 2, mt: 1 }}>
        <Button
          variant="contained"
          onClick={handleSave}
          disabled={saving}
        >
          {saving ? <CircularProgress size={18} color="inherit" /> : '保存配置'}
        </Button>
        <Button
          variant="outlined"
          onClick={handleReset}
          disabled={saving}
        >
          重置
        </Button>
      </Box>
    </Box>
  );
}
