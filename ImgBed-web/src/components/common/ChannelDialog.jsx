import { useState, useEffect } from 'react';
import {
  Dialog, DialogTitle, DialogContent, DialogActions,
  Button, TextField, FormControlLabel, Switch, FormControl,
  InputLabel, Select, MenuItem, InputAdornment, IconButton,
  Box, Typography, Alert, CircularProgress, Divider
} from '@mui/material';
import VisibilityIcon from '@mui/icons-material/Visibility';
import VisibilityOffIcon from '@mui/icons-material/VisibilityOff';
import { CHANNEL_SCHEMAS, VALID_TYPES } from '../../utils/constants';
import { StorageDocs } from '../../api';

const EMPTY_FORM = {
  id: '', type: 'local', name: '', enabled: true, allowUpload: false,
  weight: 1,
  enableQuota: false,
  quotaLimitGB: 10,
  disableThresholdPercent: 95,
  // 大小限制
  enableSizeLimit: false,
  sizeLimitMB: 10,
  // 分片上传
  enableChunking: false,
  chunkSizeMB: 5,
  maxChunks: 0,
  // 最大限制
  enableMaxLimit: false,
  maxLimitMB: 100,
  config: {},
};

export default function ChannelDialog({ open, onClose, editTarget, onSuccess }) {
  const [step, setStep] = useState(0);
  const [form, setForm] = useState(EMPTY_FORM);
  const [showSensitive, setShowSensitive] = useState({});
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState(null);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState(null);

  useEffect(() => {
    if (open) {
      if (editTarget) {
        // 编辑模式
        const editConfig = {};
        for (const [k, v] of Object.entries(editTarget.config || {})) {
          editConfig[k] = v === '***' ? '' : v;
        }
        setForm({
          id: editTarget.id,
          type: editTarget.type,
          name: editTarget.name,
          enabled: editTarget.enabled,
          allowUpload: editTarget.allowUpload,
          weight: editTarget.weight || 1,
          enableQuota: editTarget.quotaLimitGB != null && editTarget.quotaLimitGB > 0,
          quotaLimitGB: editTarget.quotaLimitGB ?? 10,
          disableThresholdPercent: editTarget.disableThresholdPercent ?? 95,
          enableSizeLimit: editTarget.enableSizeLimit ?? false,
          sizeLimitMB: editTarget.sizeLimitMB ?? 10,
          enableChunking: editTarget.enableChunking ?? false,
          chunkSizeMB: editTarget.chunkSizeMB ?? 5,
          maxChunks: editTarget.maxChunks ?? 0,
          enableMaxLimit: editTarget.enableMaxLimit ?? false,
          maxLimitMB: editTarget.maxLimitMB ?? 100,
          config: editConfig
        });
        setStep(1);
      } else {
        // 新建模式
        setForm(EMPTY_FORM);
        setStep(0);
      }
      setShowSensitive({});
      setFormError(null);
      setTestResult(null);
    }
  }, [open, editTarget]);

  const setField = (key, val) => setForm((f) => ({ ...f, [key]: val }));
  const setConfigField = (key, val) => setForm((f) => ({ ...f, config: { ...f.config, [key]: val } }));

  const handleClose = () => {
    setFormError(null);
    setTestResult(null);
    onClose();
  };

  const handleSubmit = async () => {
    setFormError(null);
    setSaving(true);
    try {
      const configPayload = {};
      const schema = CHANNEL_SCHEMAS[form.type] || [];
      for (const field of schema) {
        const val = form.config[field.key];
        if (field.sensitive && (val === '' || val === undefined)) {
          configPayload[field.key] = null;
        } else if (val !== undefined && val !== '') {
          configPayload[field.key] = val;
        }
      }

      const payload = {
        name: form.name,
        enabled: form.enabled,
        allowUpload: form.allowUpload,
        weight: form.weight ?? 1,
        enableQuota: form.enableQuota,
        quotaLimitGB: form.quotaLimitGB,
        disableThresholdPercent: form.disableThresholdPercent,
        enableSizeLimit: form.enableSizeLimit,
        sizeLimitMB: form.sizeLimitMB,
        enableChunking: form.enableChunking,
        chunkSizeMB: form.chunkSizeMB,
        maxChunks: form.maxChunks,
        enableMaxLimit: form.enableMaxLimit,
        maxLimitMB: form.maxLimitMB,
        config: configPayload,
      };

      let res;
      if (editTarget) {
        res = await StorageDocs.update(form.id, payload);
      } else {
        res = await StorageDocs.create({ ...payload, id: form.id, type: form.type });
      }

      if (res.code === 0) {
        handleClose();
        onSuccess?.();
      } else {
        setFormError(res.message || '保存失败');
      }
    } catch {
      setFormError('网络错误');
    } finally {
      setSaving(false);
    }
  };

  const handleTestConnection = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const res = await StorageDocs.test({ type: form.type, config: form.config });
      setTestResult({ ok: res.code === 0, message: res.message });
    } catch (e) {
      setTestResult({ ok: false, message: e.response?.data?.message || e.message || '测试失败' });
    } finally {
      setTesting(false);
    }
  };

  return (
    <Dialog open={open} onClose={handleClose} maxWidth="sm" fullWidth>
      <DialogTitle>{editTarget ? `编辑渠道：${editTarget.id}` : '新增存储渠道'}</DialogTitle>
      <DialogContent dividers>
        {formError && <Alert severity="error" sx={{ mb: 2 }}>{formError}</Alert>}
        {testResult && (
          <Alert severity={testResult.ok ? 'success' : 'error'} sx={{ mb: 2 }}>
            {testResult.message}
          </Alert>
        )}

        {/* 步骤 0：选择类型 */}
        {step === 0 && (
          <Box>
            <Typography variant="body2" color="text.secondary" mb={2}>选择存储类型</Typography>
            <FormControl fullWidth size="small">
              <InputLabel>存储类型</InputLabel>
              <Select value={form.type} label="存储类型" onChange={(e) => setField('type', e.target.value)}>
                {VALID_TYPES.map((t) => (
                  <MenuItem key={t} value={t}>{t}</MenuItem>
                ))}
              </Select>
            </FormControl>
          </Box>
        )}

        {/* 步骤 1：通用字段 */}
        {step === 1 && (
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            {!editTarget && (
              <TextField label="渠道 ID" size="small" required value={form.id}
                onChange={(e) => setField('id', e.target.value)}
                helperText="仅允许字母、数字、连字符，创建后不可修改" />
            )}
            <TextField label="渠道名称" size="small" required value={form.name}
              onChange={(e) => setField('name', e.target.value)} />
            <FormControlLabel
              control={<Switch checked={form.enabled} onChange={(e) => setField('enabled', e.target.checked)} />}
              label="启用渠道" />
            <FormControlLabel
              control={<Switch checked={form.allowUpload} onChange={(e) => setField('allowUpload', e.target.checked)} />}
              label="允许上传" />
            <TextField
              label="渠道权重"
              size="small"
              type="number"
              value={form.weight ?? 1}
              onChange={(e) => setField('weight', Number(e.target.value) || 1)}
              helperText="仅在负载均衡加权策略时生效，默认值为 1"
              slotProps={{ htmlInput: { min: 1, step: 1 } }}
            />
            <FormControlLabel
              control={<Switch
                checked={form.enableQuota ?? false}
                onChange={(e) => setField('enableQuota', e.target.checked)}
              />}
              label="容量限制"
            />
            {form.enableQuota && (
              <>
                <TextField
                  label="容量上限 (GB)"
                  size="small"
                  type="number"
                  value={form.quotaLimitGB ?? 10}
                  onChange={(e) => setField('quotaLimitGB', Number(e.target.value) || 10)}
                  helperText="当使用量达到停用阈值时，自动关闭上传"
                  slotProps={{ htmlInput: { min: 1, max: 10000, step: 1 } }}
                />
                <TextField
                  label="停用阈值 (%)"
                  size="small"
                  type="number"
                  value={form.disableThresholdPercent ?? 95}
                  onChange={(e) => setField('disableThresholdPercent', Number(e.target.value) || 95)}
                  helperText="建议范围：80-100，默认 95"
                  slotProps={{ htmlInput: { min: 1, max: 100, step: 1 } }}
                />
              </>
            )}

            <Divider />

            {/* 大小限制 */}
            <FormControlLabel
              control={<Switch
                checked={form.enableSizeLimit}
                onChange={(e) => {
                  const checked = e.target.checked;
                  setField('enableSizeLimit', checked);
                  if (!checked) {
                    setField('enableChunking', false);
                    setField('enableMaxLimit', false);
                  }
                }}
              />}
              label="大小限制"
            />
            {form.enableSizeLimit && (
              <>
                <TextField
                  label="单文件大小限制 (MB)"
                  size="small"
                  type="number"
                  value={form.sizeLimitMB}
                  onChange={(e) => setField('sizeLimitMB', Number(e.target.value) || 10)}
                  helperText="超过此大小的文件将被拒绝上传（开启分片后可突破此限制）"
                  slotProps={{ htmlInput: { min: 1, max: 10000, step: 1 } }}
                />

                {/* 分片上传 */}
                <FormControlLabel
                  control={<Switch
                    checked={form.enableChunking}
                    onChange={(e) => {
                      const checked = e.target.checked;
                      setField('enableChunking', checked);
                      if (!checked) {
                        setField('enableMaxLimit', false);
                      }
                    }}
                  />}
                  label="分片上传"
                  sx={{ ml: 2 }}
                />
                {form.enableChunking && (
                  <Box sx={{ ml: 4, display: 'flex', flexDirection: 'column', gap: 2 }}>
                    <TextField
                      label="分片大小 (MB)"
                      size="small"
                      type="number"
                      value={form.chunkSizeMB}
                      onChange={(e) => setField('chunkSizeMB', Number(e.target.value) || 5)}
                      helperText="每个分片的大小，默认 5MB"
                      slotProps={{ htmlInput: { min: 1, max: 1000, step: 1 } }}
                    />
                    <TextField
                      label="最大分片数"
                      size="small"
                      type="number"
                      value={form.maxChunks}
                      onChange={(e) => setField('maxChunks', Number(e.target.value) || 0)}
                      helperText="0 表示自动计算（根据文件大小和分片大小）"
                      slotProps={{ htmlInput: { min: 0, max: 10000, step: 1 } }}
                    />

                    {/* 最大限制 */}
                    <FormControlLabel
                      control={<Switch
                        checked={form.enableMaxLimit}
                        onChange={(e) => setField('enableMaxLimit', e.target.checked)}
                      />}
                      label="最大限制"
                    />
                    {form.enableMaxLimit && (
                      <TextField
                        label="单文件硬上限 (MB)"
                        size="small"
                        type="number"
                        value={form.maxLimitMB}
                        onChange={(e) => setField('maxLimitMB', Number(e.target.value) || 100)}
                        helperText="即使分片上传也不允许超过此值"
                        slotProps={{ htmlInput: { min: 1, max: 100000, step: 1 } }}
                      />
                    )}
                  </Box>
                )}
              </>
            )}
          </Box>
        )}

        {/* 步骤 2：类型特有 config 字段 */}
        {step === 2 && (
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            {(CHANNEL_SCHEMAS[form.type] || []).map((field) => (
              <TextField
                key={field.key}
                label={field.label || field.key}
                size="small"
                required={field.required}
                type={field.sensitive && !showSensitive[field.key] ? 'password' : 'text'}
                value={form.config[field.key] ?? ''}
                onChange={(e) => setConfigField(field.key, e.target.value)}
                placeholder={field.sensitive && editTarget ? '不修改请留空' : ''}
                InputProps={field.sensitive ? {
                  endAdornment: (
                    <InputAdornment position="end">
                      <IconButton size="small" onClick={() =>
                        setShowSensitive((p) => ({ ...p, [field.key]: !p[field.key] }))}>
                        {showSensitive[field.key] ? <VisibilityOffIcon fontSize="small" /> : <VisibilityIcon fontSize="small" />}
                      </IconButton>
                    </InputAdornment>
                  ),
                } : undefined}
              />
            ))}
          </Box>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={handleClose}>取消</Button>
        {step > 0 && !editTarget && <Button onClick={() => setStep((s) => s - 1)}>上一步</Button>}
        {step === 2 && (
          <Button onClick={handleTestConnection} disabled={testing || saving}>
            {testing ? <CircularProgress size={18} /> : '测试连接'}
          </Button>
        )}
        {step < 2 ? (
          <Button variant="contained" onClick={() => setStep((s) => s + 1)}>下一步</Button>
        ) : (
          <Button variant="contained" onClick={handleSubmit} disabled={saving || testing}>
            {saving ? <CircularProgress size={18} color="inherit" /> : '保存'}
          </Button>
        )}
      </DialogActions>
    </Dialog>
  );
}
