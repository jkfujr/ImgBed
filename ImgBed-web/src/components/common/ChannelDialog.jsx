import { useState, useEffect } from 'react';
import {
  Dialog, DialogTitle, DialogContent, DialogActions,
  Button, FormControl, InputLabel, Select, MenuItem,
  Box, Typography, Alert, CircularProgress, TextField,
  Accordion, AccordionSummary, AccordionDetails, Chip, Stack
} from '@mui/material';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import { VALID_TYPES, CHANNEL_SCHEMAS } from '../../utils/constants';
import { AuthDocs, StorageDocs } from '../../api';
import { useAuth } from '../../hooks/useAuth';
import ChannelFormGeneral from './ChannelFormGeneral';
import ChannelFormConfig from './ChannelFormConfig';
import {
  formatObjectSize,
  formatObjectTime,
  summarizeExistingObjects,
} from './channelExistingObjects';

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
const REVEAL_TOKEN_STORAGE_KEY = 'sensitive_config_reveal_token';

function readRevealToken() {
  try {
    return sessionStorage.getItem(REVEAL_TOKEN_STORAGE_KEY) || '';
  } catch {
    return '';
  }
}

function writeRevealToken(token) {
  try {
    sessionStorage.setItem(REVEAL_TOKEN_STORAGE_KEY, token);
  } catch {
    // 浏览器禁用 sessionStorage 时只影响本次免重复校验。
  }
}

function clearRevealToken() {
  try {
    sessionStorage.removeItem(REVEAL_TOKEN_STORAGE_KEY);
  } catch {
    // 清理失败不阻断用户重新校验。
  }
}

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

function ExistingObjectsPreview({ existingObjects }) {
  const items = existingObjects?.items || [];
  const summary = summarizeExistingObjects(existingObjects);
  if (!summary.hasItems) {
    return null;
  }

  return (
    <Accordion disableGutters elevation={0} sx={{ mt: 2, border: 1, borderColor: 'divider', '&:before': { display: 'none' } }}>
      <AccordionSummary expandIcon={<ExpandMoreIcon />}>
        <Stack direction="row" spacing={1} alignItems="center">
          <Typography variant="body2">检测到的数据</Typography>
          <Chip size="small" label={summary.countLabel} />
          {summary.truncatedLabel && <Chip size="small" color="warning" label={summary.truncatedLabel} />}
        </Stack>
      </AccordionSummary>
      <AccordionDetails sx={{ pt: 0 }}>
        <Box sx={{ maxHeight: 240, overflow: 'auto' }}>
          {items.map((item) => (
            <Box
              key={item.key}
              sx={{
                py: 1,
                borderTop: 1,
                borderColor: 'divider',
              }}
            >
              <Typography
                variant="body2"
                sx={{
                  fontFamily: 'monospace',
                  overflowWrap: 'anywhere',
                }}
              >
                {item.key}
              </Typography>
              <Typography variant="caption" color="text.secondary">
                {formatObjectSize(item.size)} · {formatObjectTime(item.lastModified)}
              </Typography>
            </Box>
          ))}
        </Box>
      </AccordionDetails>
    </Accordion>
  );
}

export default function ChannelDialog({ open, onClose, editTarget, onSuccess }) {
  const { user } = useAuth();
  const [step, setStep] = useState(0);
  const [form, setForm] = useState(EMPTY_FORM);
  const [showSensitive, setShowSensitive] = useState({});
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState(null);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState(null);
  const [revealDialog, setRevealDialog] = useState({
    open: false,
    key: '',
    username: '',
    password: '',
    error: '',
    loading: false,
  });
  const [revealLoadingKey, setRevealLoadingKey] = useState('');
  const [s3ConfirmOpen, setS3ConfirmOpen] = useState(false);
  const [s3ExistingObjects, setS3ExistingObjects] = useState(null);

  useEffect(() => {
    if (open) {
      setForm(editTarget ? buildEditForm(editTarget) : EMPTY_FORM);
      setStep(editTarget ? 1 : 0);
      setShowSensitive({});
      setFormError(null);
      setTestResult(null);
      setRevealDialog({
        open: false,
        key: '',
        username: user?.username || '',
        password: '',
        error: '',
        loading: false,
      });
      setRevealLoadingKey('');
      setS3ConfirmOpen(false);
      setS3ExistingObjects(null);
    }
  }, [open, editTarget, user?.username]);

  const setField = (key, val) => setForm((f) => ({ ...f, [key]: val }));
  const setConfigField = (key, val) => setForm((f) => ({ ...f, config: { ...f.config, [key]: val } }));

  const handleClose = () => {
    setFormError(null);
    setTestResult(null);
    setRevealDialog((current) => ({ ...current, open: false, password: '', error: '', loading: false }));
    setRevealLoadingKey('');
    setS3ConfirmOpen(false);
    setS3ExistingObjects(null);
    onClose();
  };

  const buildPayload = () => {
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

    return {
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
  };

  const submitStorage = async (s3NonEmptyAction = null) => {
    setFormError(null);
    setSaving(true);
    try {
      const payload = buildPayload();

      let res;
      if (editTarget) {
        res = await StorageDocs.update(form.id, payload);
      } else {
        const createPayload = { ...payload, id: form.id, type: form.type };
        if (s3NonEmptyAction) {
          createPayload.s3NonEmptyAction = s3NonEmptyAction;
        }
        res = await StorageDocs.create(createPayload);
      }

      if (res.code === 0) {
        handleClose();
        onSuccess?.();
      } else {
        setS3ConfirmOpen(false);
        setFormError(res.message || '保存失败');
      }
    } catch (error) {
      const errorPayload = error.response?.data || {};

      if (!editTarget && form.type === 's3' && !s3NonEmptyAction
        && errorPayload.code === 409 && errorPayload.reason === 'S3_BUCKET_NOT_EMPTY') {
        setS3ExistingObjects(errorPayload.details?.existingObjects || null);
        setS3ConfirmOpen(true);
        return;
      }

      setS3ConfirmOpen(false);
      setFormError(errorPayload.message || error.message || '网络错误');
    } finally {
      setSaving(false);
    }
  };

  const handleSubmit = async () => {
    await submitStorage();
  };

  const handleTestConnection = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const res = await StorageDocs.test({
        id: editTarget ? form.id : undefined,
        type: form.type,
        config: form.config,
      });
      setTestResult({ ok: res.code === 0, message: res.message });
    } catch (e) {
      setTestResult({ ok: false, message: e.response?.data?.message || e.message || '测试失败' });
    } finally {
      setTesting(false);
    }
  };

  const isEmptySensitiveValue = (value) => value === '' || value === undefined || value === null;

  const openRevealDialog = (key, error = '') => {
    setRevealDialog({
      open: true,
      key,
      username: user?.username || '',
      password: '',
      error,
      loading: false,
    });
  };

  const revealStoredConfig = async (key, token) => {
    setRevealLoadingKey(key);
    try {
      const res = await StorageDocs.revealConfig(form.id, { key }, token);
      if (res.code !== 0) {
        throw new Error(res.message || '查看敏感配置失败');
      }
      setConfigField(key, res.data?.value ?? '');
      setShowSensitive((current) => ({ ...current, [key]: true }));
    } finally {
      setRevealLoadingKey('');
    }
  };

  const handleToggleSensitive = async (field) => {
    const key = field.key;
    if (showSensitive[key]) {
      setShowSensitive((current) => ({ ...current, [key]: false }));
      return;
    }

    if (!editTarget || !isEmptySensitiveValue(form.config[key])) {
      setShowSensitive((current) => ({ ...current, [key]: true }));
      return;
    }

    const token = readRevealToken();
    if (!token) {
      openRevealDialog(key);
      return;
    }

    try {
      await revealStoredConfig(key, token);
    } catch (error) {
      const message = error.response?.data?.message || error.message || '查看敏感配置失败';
      clearRevealToken();
      if (error.response?.status === 401 || error.response?.status === 403) {
        openRevealDialog(key, message);
        return;
      }
      setFormError(message);
    }
  };

  const handleRevealDialogClose = () => {
    if (revealDialog.loading) {
      return;
    }
    setRevealDialog((current) => ({
      ...current,
      open: false,
      password: '',
      error: '',
    }));
  };

  const setRevealDialogField = (key, value) => {
    setRevealDialog((current) => ({
      ...current,
      [key]: value,
      error: '',
    }));
  };

  const handleRevealSubmit = async () => {
    setRevealDialog((current) => ({ ...current, loading: true, error: '' }));
    try {
      const res = await AuthDocs.reauth({
        username: revealDialog.username,
        password: revealDialog.password,
      });
      if (res.code !== 0 || !res.data?.token) {
        throw new Error(res.message || '二次校验失败');
      }

      writeRevealToken(res.data.token);
      await revealStoredConfig(revealDialog.key, res.data.token);
      setRevealDialog((current) => ({
        ...current,
        open: false,
        password: '',
        error: '',
        loading: false,
      }));
    } catch (error) {
      clearRevealToken();
      setRevealDialog((current) => ({
        ...current,
        error: error.response?.data?.message || error.message || '二次校验失败',
        loading: false,
      }));
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
            editTarget={editTarget}
            onToggleSensitive={handleToggleSensitive}
            revealLoadingKey={revealLoadingKey}
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

      <Dialog
        open={revealDialog.open}
        onClose={handleRevealDialogClose}
        maxWidth="xs"
        fullWidth
      >
        <DialogTitle>二次校验</DialogTitle>
        <DialogContent dividers>
          {revealDialog.error && <Alert severity="error" sx={{ mb: 2 }}>{revealDialog.error}</Alert>}
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            查看已保存密钥需要重新输入管理员账号密码，校验通过后 10 分钟内有效。
          </Typography>
          <Stack spacing={2}>
            <TextField
              label="管理员账号"
              size="small"
              value={revealDialog.username}
              disabled={revealDialog.loading}
              onChange={(event) => setRevealDialogField('username', event.target.value)}
            />
            <TextField
              label="管理员密码"
              type="password"
              size="small"
              value={revealDialog.password}
              disabled={revealDialog.loading}
              onChange={(event) => setRevealDialogField('password', event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && revealDialog.username && revealDialog.password) {
                  void handleRevealSubmit();
                }
              }}
            />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={handleRevealDialogClose} disabled={revealDialog.loading}>
            取消
          </Button>
          <Button
            variant="contained"
            onClick={handleRevealSubmit}
            disabled={revealDialog.loading || !revealDialog.username || !revealDialog.password}
          >
            {revealDialog.loading ? <CircularProgress size={18} color="inherit" /> : '校验并查看'}
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog
        open={s3ConfirmOpen}
        onClose={saving ? () => {} : () => setS3ConfirmOpen(false)}
        maxWidth="xs"
        fullWidth
      >
        <DialogTitle>S3 存储中已存在文件</DialogTitle>
        <DialogContent dividers>
          <Typography variant="body2">
            当前 Bucket 中已检测到已有对象。是否需要先清空整个 Bucket 再创建该存储？
          </Typography>
          <ExistingObjectsPreview existingObjects={s3ExistingObjects} />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setS3ConfirmOpen(false)} disabled={saving}>
            取消
          </Button>
          <Button onClick={() => submitStorage('keep')} disabled={saving}>
            继续创建
          </Button>
          <Button variant="contained" color="error" onClick={() => submitStorage('clear_bucket')} disabled={saving}>
            清空并创建
          </Button>
        </DialogActions>
      </Dialog>
    </Dialog>
  );
}
