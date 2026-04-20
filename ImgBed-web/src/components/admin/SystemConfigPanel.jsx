import { useState, useEffect, useRef } from 'react';
import {
  Box, TextField, Button, CircularProgress, Alert, Divider, Typography,
} from '@mui/material';
import { SystemConfigDocs } from '../../api';
import LoadingSpinner from '../common/LoadingSpinner';
import { createRequestGuard } from '../../utils/request-guard';

export default function SystemConfigPanel() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState(null);
  const [corsOrigin, setCorsOrigin] = useState('');
  const [serverPort, setServerPort] = useState('');
  const [initialConfig, setInitialConfig] = useState(null);
  const requestGuardRef = useRef(createRequestGuard());

  useEffect(() => {
    const guard = requestGuardRef.current;
    return () => {
      guard.dispose();
    };
  }, []);

  useEffect(() => {
    const loadConfig = async () => {
      const requestId = requestGuardRef.current.begin();
      setLoading(true);

      try {
        const res = await SystemConfigDocs.get();
        if (!requestGuardRef.current.isCurrent(requestId)) {
          return;
        }

        if (res.code === 0) {
          const corsValue = res.data.security?.corsOrigin || '*';
          const portValue = String(res.data.server?.port || 3000);

          setCorsOrigin(corsValue);
          setServerPort(portValue);
          setInitialConfig({
            corsOrigin: corsValue,
            serverPort: portValue,
          });
        }
      } catch {
        if (!requestGuardRef.current.isCurrent(requestId)) {
          return;
        }

        setResult({ type: 'error', msg: '加载配置失败，请检查网络或后端服务' });
      } finally {
        if (requestGuardRef.current.isCurrent(requestId)) {
          setLoading(false);
        }
      }
    };

    loadConfig();
  }, []);

  const handleReset = () => {
    if (!initialConfig) {
      return;
    }

    setCorsOrigin(initialConfig.corsOrigin);
    setServerPort(initialConfig.serverPort);
    setResult(null);
  };

  const handleSave = async () => {
    const requestId = requestGuardRef.current.begin();
    setResult(null);
    setSaving(true);

    try {
      const payload = {
        security: {
          corsOrigin,
        },
        server: { port: parseInt(serverPort, 10) },
      };
      const res = await SystemConfigDocs.update(payload);
      if (!requestGuardRef.current.isCurrent(requestId)) {
        return;
      }

      if (res.code === 0) {
        setResult({ type: 'success', msg: res.message });
      } else {
        setResult({ type: 'error', msg: res.message || '保存失败' });
      }
    } catch (err) {
      if (!requestGuardRef.current.isCurrent(requestId)) {
        return;
      }

      setResult({ type: 'error', msg: err.response?.data?.message || '网络错误' });
    } finally {
      if (requestGuardRef.current.isCurrent(requestId)) {
        setSaving(false);
      }
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
        服务配置
      </Typography>

      <TextField
        label="服务端口"
        size="small"
        type="number"
        value={serverPort}
        onChange={(event) => setServerPort(event.target.value)}
        sx={{ maxWidth: 200 }}
      />
      <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: -1.5 }}>
        修改后需要重启后端服务生效
      </Typography>

      <Divider sx={{ my: 1 }} />

      <Typography variant="subtitle1" fontWeight="bold" mb={1}>
        安全配置
      </Typography>

      <TextField
        label="CORS 允许来源"
        size="small"
        value={corsOrigin}
        onChange={(event) => setCorsOrigin(event.target.value)}
      />
      <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: -1.5 }}>
        填 `*` 表示允许所有来源，生产环境建议填写具体域名
      </Typography>

      <Box sx={{ display: 'flex', gap: 2, mt: 1 }}>
        <Button variant="contained" onClick={handleSave} disabled={saving}>
          {saving ? <CircularProgress size={18} color="inherit" /> : '保存配置'}
        </Button>
        <Button variant="outlined" onClick={handleReset} disabled={saving}>
          重置
        </Button>
      </Box>
    </Box>
  );
}
