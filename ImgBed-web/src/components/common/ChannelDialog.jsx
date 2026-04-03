import { useState, useEffect } from 'react';
import {
  Dialog, DialogTitle, DialogContent, DialogActions,
  Button, FormControl, InputLabel, Select, MenuItem,
  Box, Typography, Alert, CircularProgress
} from '@mui/material';
import { VALID_TYPES, CHANNEL_SCHEMAS } from '../../utils/constants';
import { StorageDocs } from '../../api';
import ChannelFormGeneral from './ChannelFormGeneral';
import ChannelFormConfig from './ChannelFormConfig';

const EMPTY_FORM = {
  id: '', type: 'local', name: '', enabled: true, allowUpload: false,
  weight: 1,
  enableQuota: false,
  quotaLimitGB: 10,
  disableThresholdPercent: 95,
  enableSizeLimit: false,
  sizeLimitMB: 10,
  enableChunking: false,
  chunkSizeMB: 5,
  maxChunks: 0,
  enableMaxLimit: false,
  maxLimitMB: 100,
  config: {},
};

/** 从 editTarget 构造表单初始值 */
function buildEditForm(target) {
  const editConfig = {};
  for (const [k, v] of Object.entries(target.config || {})) {
    editConfig[k] = v === '***' ? '' : v;
  }
  return {
    id: target.id, type: target.type, name: target.name,
    enabled: target.enabled, allowUpload: target.allowUpload,
    weight: target.weight || 1,
    enableQuota: target.quotaLimitGB != null && target.quotaLimitGB > 0,
    quotaLimitGB: target.quotaLimitGB ?? 10,
    disableThresholdPercent: target.disableThresholdPercent ?? 95,
    enableSizeLimit: target.enableSizeLimit ?? false, sizeLimitMB: target.sizeLimitMB ?? 10,
    enableChunking: target.enableChunking ?? false, chunkSizeMB: target.chunkSizeMB ?? 5,
    maxChunks: target.maxChunks ?? 0,
    enableMaxLimit: target.enableMaxLimit ?? false, maxLimitMB: target.maxLimitMB ?? 100,
    config: editConfig,
  };
}

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
      setForm(editTarget ? buildEditForm(editTarget) : EMPTY_FORM);
      setStep(editTarget ? 1 : 0);
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
        name: form.name, enabled: form.enabled, allowUpload: form.allowUpload,
        weight: form.weight ?? 1,
        enableQuota: form.enableQuota, quotaLimitGB: form.quotaLimitGB,
        disableThresholdPercent: form.disableThresholdPercent,
        enableSizeLimit: form.enableSizeLimit, sizeLimitMB: form.sizeLimitMB,
        enableChunking: form.enableChunking, chunkSizeMB: form.chunkSizeMB,
        maxChunks: form.maxChunks,
        enableMaxLimit: form.enableMaxLimit, maxLimitMB: form.maxLimitMB,
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
          <ChannelFormGeneral form={form} setField={setField} editTarget={editTarget} />
        )}

        {/* 步骤 2：类型特有 config 字段 */}
        {step === 2 && (
          <ChannelFormConfig
            form={form}
            setConfigField={setConfigField}
            showSensitive={showSensitive}
            setShowSensitive={setShowSensitive}
            editTarget={editTarget}
          />
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
