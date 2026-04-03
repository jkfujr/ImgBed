import React, { useState, useEffect } from 'react';
import {
  Box, Typography, Paper, TextField, Button, CircularProgress, Alert, Divider,
  FormControl, Radio, RadioGroup, FormControlLabel, Switch
} from '@mui/material';
import { api } from '../../api';
import { BORDER_RADIUS } from '../../utils/constants';

export default function UploadConfigPanel() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState(null);
  const [quotaCheckMode, setQuotaCheckMode] = useState('auto');
  const [fullCheckIntervalHours, setFullCheckIntervalHours] = useState(6);
  const [sysEnableSizeLimit, setSysEnableSizeLimit] = useState(false);
  const [sysEnableChunking, setSysEnableChunking] = useState(false);
  const [sysEnableMaxLimit, setSysEnableMaxLimit] = useState(false);
  const [defaultSizeLimitMB, setDefaultSizeLimitMB] = useState(10);
  const [defaultChunkSizeMB, setDefaultChunkSizeMB] = useState(5);
  const [defaultMaxChunks, setDefaultMaxChunks] = useState(0);
  const [defaultMaxLimitMB, setDefaultMaxLimitMB] = useState(100);

  useEffect(() => {
    const loadConfig = async () => {
      setLoading(true);
      try {
        const res = await api.get('/api/system/config');
        if (res.code === 0) {
          setQuotaCheckMode(res.data.upload?.quotaCheckMode || 'auto');
          setFullCheckIntervalHours(res.data.upload?.fullCheckIntervalHours || 6);
          setSysEnableSizeLimit(res.data.upload?.enableSizeLimit ?? false);
          setDefaultSizeLimitMB(res.data.upload?.defaultSizeLimitMB || 10);
          setSysEnableChunking(res.data.upload?.enableChunking ?? false);
          setDefaultChunkSizeMB(res.data.upload?.defaultChunkSizeMB || 5);
          setDefaultMaxChunks(res.data.upload?.defaultMaxChunks ?? 0);
          setSysEnableMaxLimit(res.data.upload?.enableMaxLimit ?? false);
          setDefaultMaxLimitMB(res.data.upload?.defaultMaxLimitMB || 100);
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
    setSaving(true);
    try {
      const payload = {
        upload: {
          quotaCheckMode,
          fullCheckIntervalHours,
          enableSizeLimit: sysEnableSizeLimit,
          defaultSizeLimitMB,
          enableChunking: sysEnableChunking,
          defaultChunkSizeMB,
          defaultMaxChunks,
          enableMaxLimit: sysEnableMaxLimit,
          defaultMaxLimitMB,
        }
      };
      const res = await api.put('/api/system/config', payload);
      if (res.code === 0) {
        setResult({ type: 'success', msg: '上传配置已保存，重启服务后定时间隔生效' });
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
      <Typography variant="subtitle1" fontWeight="bold" mb={2}>容量检查</Typography>
      <Box display="flex" flexDirection="column" gap={2.5}>
        {result && (
          <Alert severity={result.type} onClose={() => setResult(null)}>{result.msg}</Alert>
        )}
        <FormControl component="fieldset">
          <RadioGroup
            value={quotaCheckMode}
            onChange={(e) => setQuotaCheckMode(e.target.value)}
          >
            <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 1, py: 1 }}>
              <Radio checked={quotaCheckMode === 'auto'} value="auto" size="medium" />
              <Box sx={{ pt: 0.5 }}>
                <Typography>自动</Typography>
                <Typography variant="body2" color="text.secondary">
                  内存缓存已用容量 + 上传/删除增量更新 + 定时全量校正。
                </Typography>
              </Box>
            </Box>
            <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 1, py: 1 }}>
              <Radio checked={quotaCheckMode === 'always'} value="always" size="medium" />
              <Box sx={{ pt: 0.5 }}>
                <Typography>全量检查</Typography>
                <Typography variant="body2" color="text.secondary">
                  每次上传都遍历数据库全量统计，准确但较慢，不推荐
                </Typography>
              </Box>
            </Box>
          </RadioGroup>
        </FormControl>

        {quotaCheckMode === 'auto' && (
          <TextField
            label="定时全量校正间隔（小时）"
            size="small"
            type="number"
            value={fullCheckIntervalHours}
            onChange={(e) => setFullCheckIntervalHours(Math.max(1, Number(e.target.value) || 6))}
            helperText="定期从数据库全量校正，防止缓存与实际不一致。默认 6 小时"
            slotProps={{ htmlInput: { min: 1, max: 168, step: 1 } }}
            sx={{ maxWidth: 300 }}
          />
        )}

        <Divider sx={{ my: 1 }} />

        <Typography variant="subtitle1" fontWeight="bold" mb={1}>上传限制</Typography>
        <Typography variant="body2" color="text.secondary" mb={1}>
          渠道未单独开启对应开关时，将使用此处配置
        </Typography>

        <FormControlLabel
          control={<Switch
            checked={sysEnableSizeLimit}
            onChange={(e) => {
              const checked = e.target.checked;
              setSysEnableSizeLimit(checked);
              if (!checked) {
                setSysEnableChunking(false);
                setSysEnableMaxLimit(false);
              }
            }}
          />}
          label="大小限制"
        />
        {sysEnableSizeLimit && (
          <>
            <TextField
              label="单文件大小限制 (MB)"
              size="small"
              type="number"
              value={defaultSizeLimitMB}
              onChange={(e) => setDefaultSizeLimitMB(Number(e.target.value) || 10)}
              helperText={'超过此大小的文件将被拒绝上传（开启分片后可突破此限制）'}
              slotProps={{ htmlInput: { min: 1, max: 10000, step: 1 } }}
              sx={{ maxWidth: 300 }}
            />

            <FormControlLabel
              control={<Switch
                checked={sysEnableChunking}
                onChange={(e) => {
                  const checked = e.target.checked;
                  setSysEnableChunking(checked);
                  if (!checked) {
                    setSysEnableMaxLimit(false);
                  }
                }}
              />}
              label="分片上传"
              sx={{ ml: 2 }}
            />
            {sysEnableChunking && (
              <Box sx={{ ml: 4, display: 'flex', flexDirection: 'column', gap: 2 }}>
                <TextField
                  label="分片大小 (MB)"
                  size="small"
                  type="number"
                  value={defaultChunkSizeMB}
                  onChange={(e) => setDefaultChunkSizeMB(Number(e.target.value) || 5)}
                  helperText={'每个分片的大小，默认 5MB'}
                  slotProps={{ htmlInput: { min: 1, max: 1000, step: 1 } }}
                  sx={{ maxWidth: 300 }}
                />
                <TextField
                  label="最大分片数"
                  size="small"
                  type="number"
                  value={defaultMaxChunks}
                  onChange={(e) => setDefaultMaxChunks(Number(e.target.value) || 0)}
                  helperText={'0 表示自动计算（根据文件大小和分片大小）'}
                  slotProps={{ htmlInput: { min: 0, max: 10000, step: 1 } }}
                  sx={{ maxWidth: 300 }}
                />

                <FormControlLabel
                  control={<Switch
                    checked={sysEnableMaxLimit}
                    onChange={(e) => setSysEnableMaxLimit(e.target.checked)}
                  />}
                  label="最大限制"
                />
                {sysEnableMaxLimit && (
                  <TextField
                    label="单文件硬上限 (MB)"
                    size="small"
                    type="number"
                    value={defaultMaxLimitMB}
                    onChange={(e) => setDefaultMaxLimitMB(Number(e.target.value) || 100)}
                    helperText={'即使分片上传也不允许超过此值'}
                    slotProps={{ htmlInput: { min: 1, max: 100000, step: 1 } }}
                    sx={{ maxWidth: 300 }}
                  />
                )}
              </Box>
            )}
          </>
        )}

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
