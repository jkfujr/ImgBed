import React, { useState, useEffect } from 'react';
import {
  Box, Typography, Paper, TextField, Button, CircularProgress,
  Alert, Divider, FormControl, InputLabel, Select, MenuItem, Grid,
} from '@mui/material';
import { api, StorageDocs } from '../../api';

export default function SystemPage() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState(null);

  const [corsOrigin, setCorsOrigin] = useState('');
  const [maxFileSize, setMaxFileSize] = useState('');
  const [serverPort, setServerPort] = useState('');

  // 负载均衡配置
  const [lbLoading, setLbLoading] = useState(false);
  const [lbSaving, setLbSaving] = useState(false);
  const [lbResult, setLbResult] = useState(null);
  const [lbStrategy, setLbStrategy] = useState('default');
  const [lbWeights, setLbWeights] = useState({});
  const [availableChannels, setAvailableChannels] = useState([]);

  useEffect(() => {
    api.get('/api/system/config').then((res) => {
      if (res.code === 0) {
        setCorsOrigin(res.data.security?.corsOrigin || '*');
        setMaxFileSize(String((res.data.security?.maxFileSize || 104857600) / (1024 * 1024)));
        setServerPort(String(res.data.server?.port || 3000));
      }
    }).catch(() => {
      setResult({ type: 'error', msg: '加载配置失败，请检查网络或后端服务' });
    }).finally(() => setLoading(false));

    // 加载负载均衡配置和渠道列表
    loadLoadBalanceConfig();
    loadChannels();
  }, []);

  const loadLoadBalanceConfig = async () => {
    setLbLoading(true);
    try {
      const res = await StorageDocs.getLoadBalance();
      if (res.code === 0) {
        setLbStrategy(res.data.strategy || 'default');
        setLbWeights(res.data.weights || {});
      }
    } catch (err) {
      console.error('加载负载均衡配置失败', err);
    } finally {
      setLbLoading(false);
    }
  };

  const loadChannels = async () => {
    try {
      const res = await StorageDocs.list();
      if (res.code === 0) {
        setAvailableChannels(res.data.list || []);
      }
    } catch (err) {
      console.error('加载渠道列表失败', err);
    }
  };

  const handleSaveLb = async () => {
    setLbResult(null);
    setLbSaving(true);
    try {
      const res = await StorageDocs.updateLoadBalance({ strategy: lbStrategy, weights: lbWeights });
      if (res.code === 0) {
        setLbResult({ type: 'success', msg: '负载均衡配置已保存' });
      } else {
        setLbResult({ type: 'error', msg: res.message || '保存失败' });
      }
    } catch (err) {
      setLbResult({ type: 'error', msg: err.response?.data?.message || '网络错误' });
    } finally {
      setLbSaving(false);
    }
  };

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
      const res = await api.put('/api/system/config', payload);
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
    <Box sx={{ maxWidth: 680 }}>
      <Typography variant="h6" fontWeight="bold" mb={2}>系统配置</Typography>

      <Paper variant="outlined" sx={{ borderRadius: 2, px: 3, py: 3 }}>
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

      {/* 存储上传策略 */}
      <Paper variant="outlined" sx={{ borderRadius: 2, px: 3, py: 3, mt: 3 }}>
        <Typography variant="subtitle1" fontWeight="bold" mb={2}>存储上传策略</Typography>
        <Box display="flex" flexDirection="column" gap={2.5}>
          {lbResult && (
            <Alert severity={lbResult.type} onClose={() => setLbResult(null)}>{lbResult.msg}</Alert>
          )}
          {lbLoading ? (
            <Box display="flex" justifyContent="center" py={2}><CircularProgress size={24} /></Box>
          ) : (
            <>
              <FormControl size="small" sx={{ maxWidth: 280 }}>
                <InputLabel>上传策略</InputLabel>
                <Select value={lbStrategy} label="上传策略" onChange={(e) => setLbStrategy(e.target.value)}>
                  <MenuItem value="default">默认渠道</MenuItem>
                  <MenuItem value="round-robin">轮询</MenuItem>
                  <MenuItem value="random">随机</MenuItem>
                  <MenuItem value="least-used">最少使用</MenuItem>
                  <MenuItem value="weighted">加权</MenuItem>
                </Select>
              </FormControl>
              <Typography variant="body2" color="text.secondary">
                {lbStrategy === 'default' && '所有上传使用默认渠道'}
                {lbStrategy === 'round-robin' && '在所有可上传渠道中按顺序轮流分配'}
                {lbStrategy === 'random' && '在所有可上传渠道中随机选择'}
                {lbStrategy === 'least-used' && '优先选择文件数最少的渠道'}
                {lbStrategy === 'weighted' && '按各渠道权重比例随机分配'}
              </Typography>
              {lbStrategy === 'weighted' && (
                <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 2, alignItems: 'center' }}>
                  {availableChannels.filter(s => s.enabled && s.allowUpload).map(s => (
                    <Box key={s.id} sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                      <Typography variant="body2" noWrap>{s.name}:</Typography>
                      <TextField type="number" size="small" value={lbWeights[s.id] || 1} slotProps={{ htmlInput: { min: 1, step: 1 } }}
                        onChange={(e) => setLbWeights(prev => ({ ...prev, [s.id]: Number(e.target.value) || 1 }))}
                        sx={{ width: 80 }} />
                    </Box>
                  ))}
                  {availableChannels.filter(s => s.enabled && s.allowUpload).length === 0 && (
                    <Typography variant="body2" color="text.secondary">暂无可上传渠道</Typography>
                  )}
                </Box>
              )}
              <Box>
                <Button variant="contained" onClick={handleSaveLb} disabled={lbSaving}>
                  {lbSaving ? <CircularProgress size={18} color="inherit" /> : '保存策略'}
                </Button>
              </Box>
            </>
          )}
        </Box>
      </Paper>
    </Box>
  );
}
