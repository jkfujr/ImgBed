import { useState, useEffect } from 'react';
import {
  Box, Paper, TextField, Button, CircularProgress, Alert, Divider
} from '@mui/material';
import { SystemConfigDocs } from '../../api';
import { BORDER_RADIUS } from '../../utils/constants';

export default function SystemConfigPanel() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState(null);
  const [corsOrigin, setCorsOrigin] = useState('');
  const [maxFileSize, setMaxFileSize] = useState('');
  const [serverPort, setServerPort] = useState('');

  useEffect(() => {
    const loadConfig = async () => {
      setLoading(true);
      try {
        const res = await SystemConfigDocs.get();
        if (res.code === 0) {
          setCorsOrigin(res.data.security?.corsOrigin || '*');
          setMaxFileSize(String((res.data.security?.maxFileSize || 104857600) / (1024 * 1024)));
          setServerPort(String(res.data.server?.port || 3000));
        }
      } catch {
        setResult({ type: 'error', msg: '加载配置失败，请检查网络或后端服务' });
      } finally {
        setLoading(false);
      }
    };

    loadConfig();
  }, []);

  const handleSave = async () => {
    setResult(null);
    setSaving(true);
    try {
      const payload = {
        security: {
          corsOrigin,
          maxFileSize: Math.round(parseFloat(maxFileSize) * 1024 * 1024),
        },
        server: { port: parseInt(serverPort) },
      };
      const res = await SystemConfigDocs.update(payload);
      if (res.code === 0) {
        setResult({ type: 'success', msg: res.message });
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
    return <Box display="flex" justifyContent="center" pt={6}><CircularProgress /></Box>;
  }

  return (
    <Paper variant="outlined" sx={{ borderRadius: BORDER_RADIUS.md, px: 3, py: 3 }}>
      <Box display="flex" flexDirection="column" gap={2.5}>
        {result && (
          <Alert severity={result.type} onClose={() => setResult(null)}>{result.msg}</Alert>
        )}

        <TextField
          label="服务端口"
          size="small"
          value={serverPort}
          onChange={(e) => setServerPort(e.target.value)}
          helperText="修改后需重启后端服务生效"
          sx={{ maxWidth: 200 }}
        />

        <Divider />

        <TextField
          label="CORS 允许来源"
          size="small"
          value={corsOrigin}
          onChange={(e) => setCorsOrigin(e.target.value)}
          helperText="填 * 表示允许所有来源，生产环境建议填写具体域名"
        />

        <TextField
          label="最大上传文件大小（MB）"
          size="small"
          type="number"
          value={maxFileSize}
          onChange={(e) => setMaxFileSize(e.target.value)}
          slotProps={{ htmlInput: { min: 1, step: 1 } }}
          sx={{ maxWidth: 280 }}
        />

        <Box>
          <Button
            variant="contained"
            onClick={handleSave}
            disabled={saving}
          >
            {saving ? <CircularProgress size={18} color="inherit" /> : '保存配置'}
          </Button>
        </Box>
      </Box>
    </Paper>
  );
}
