import React, { useState, useEffect } from 'react';
import {
  Box, Typography, Paper, TextField, Button, CircularProgress,
  Alert, Divider, Select, MenuItem, FormControl, InputLabel,
  Tabs, Tab, Chip, Table, TableBody, TableCell, TableRow
} from '@mui/material';
import StorageIcon from '@mui/icons-material/Storage';
import TuneIcon from '@mui/icons-material/Tune';
import { api } from '../../api';

function TabPanel({ value, index, children }) {
  return value === index ? <Box sx={{ pt: 3 }}>{children}</Box> : null;
}

export default function SystemPage() {
  const [tab, setTab] = useState(0);
  const [config, setConfig] = useState(null);
  const [storages, setStorages] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState(null);

  // 可编辑字段
  const [corsOrigin, setCorsOrigin] = useState('');
  const [maxFileSize, setMaxFileSize] = useState('');
  const [defaultStorage, setDefaultStorage] = useState('');
  const [serverPort, setServerPort] = useState('');

  useEffect(() => {
    Promise.all([
      api.get('/api/system/config'),
      api.get('/api/system/storages'),
    ]).then(([cfgRes, storRes]) => {
      if (cfgRes.code === 0) {
        setConfig(cfgRes.data);
        setCorsOrigin(cfgRes.data.security?.corsOrigin || '*');
        setMaxFileSize(String((cfgRes.data.security?.maxFileSize || 104857600) / (1024 * 1024)));
        setServerPort(String(cfgRes.data.server?.port || 3000));
      }
      if (storRes.code === 0) {
        setStorages(storRes.data.list || []);
        setDefaultStorage(storRes.data.default || '');
      }
    }).catch(() => {
      setResult({ type: 'error', msg: '加载配置失败，请检查网络或后端服务' });
    }).finally(() => setLoading(false));
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
        storage: { default: defaultStorage },
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

      <Paper variant="outlined" sx={{ borderRadius: 2 }}>
        <Tabs value={tab} onChange={(_, v) => setTab(v)} sx={{ px: 2, borderBottom: 1, borderColor: 'divider' }}>
          <Tab icon={<TuneIcon fontSize="small" />} iconPosition="start" label="基础设置" />
          <Tab icon={<StorageIcon fontSize="small" />} iconPosition="start" label="存储渠道" />
        </Tabs>

        <Box sx={{ px: 3, pb: 3 }}>
          {/* 基础设置 */}
          <TabPanel value={tab} index={0}>
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
                inputProps={{ min: 1, step: 1 }}
                sx={{ maxWidth: 280 }}
              />

              <Divider />

              <FormControl size="small" sx={{ maxWidth: 300 }}>
                <InputLabel>默认存储渠道</InputLabel>
                <Select
                  value={defaultStorage}
                  label="默认存储渠道"
                  onChange={(e) => setDefaultStorage(e.target.value)}
                >
                  {storages.map((s) => (
                    <MenuItem key={s.id} value={s.id}>
                      {s.name}（{s.type}）
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>

              <Box>
                <Button
                  variant="contained"
                  onClick={handleSave}
                  disabled={saving}
                  sx={{ alignSelf: 'flex-start' }}
                >
                  {saving ? <CircularProgress size={18} color="inherit" /> : '保存配置'}
                </Button>
              </Box>
            </Box>
          </TabPanel>

          {/* 存储渠道 */}
          <TabPanel value={tab} index={1}>
            <Typography variant="body2" color="text.secondary" mb={2}>
              以下为当前已配置的存储渠道，如需添加或修改渠道，请直接编辑后端 config.json 文件。
            </Typography>
            <Table size="small">
              <TableBody>
                {storages.map((s) => (
                  <TableRow key={s.id}>
                    <TableCell sx={{ fontWeight: 'medium' }}>{s.name}</TableCell>
                    <TableCell><Chip label={s.type} size="small" /></TableCell>
                    <TableCell>{s.id}</TableCell>
                    <TableCell>
                      <Chip
                        label={s.enabled ? '已启用' : '已禁用'}
                        color={s.enabled ? 'success' : 'default'}
                        size="small"
                        variant="outlined"
                      />
                    </TableCell>
                    <TableCell>
                      {s.id === defaultStorage && (
                        <Chip label="默认" color="primary" size="small" />
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TabPanel>
        </Box>
      </Paper>
    </Box>
  );
}
