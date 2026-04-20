import { useState, useMemo } from 'react';
import {
  Alert, Box, Button, Dialog, DialogActions, DialogContent, DialogTitle,
  FormControl, FormControlLabel, FormLabel, Radio, RadioGroup, Checkbox,
  TextField, Typography, CircularProgress
} from '@mui/material';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import { PERMISSION_OPTIONS } from '../../constants/permissions.js';

const INITIAL_FORM = {
  name: '',
  permissions: ['upload:image'],
  expiresMode: 'never',
  expiresAt: ''
};

function buildEditForm(initialData) {
  return {
    name: initialData.name || '',
    permissions: initialData.permissions || [],
    expiresMode: initialData.expires_at ? 'custom' : 'never',
    expiresAt: initialData.expires_at
      ? new Date(initialData.expires_at).toISOString().slice(0, 16)
      : ''
  };
}

export default function ApiTokenDialog({ open, onClose, onSubmit, submitting, mode = 'create', initialData = null }) {
  const [form, setForm] = useState(INITIAL_FORM);
  const [createResult, setCreateResult] = useState(null);
  const [error, setError] = useState('');
  const [copySuccess, setCopySuccess] = useState('');
  const openKey = `${open ? '1' : '0'}|${mode}|${initialData?.id ?? ''}`;
  const [prevOpenKey, setPrevOpenKey] = useState(openKey);
  if (prevOpenKey !== openKey) {
    setPrevOpenKey(openKey);
    if (open) {
      setForm(mode === 'edit' && initialData ? buildEditForm(initialData) : INITIAL_FORM);
      setCreateResult(null);
      setError('');
      setCopySuccess('');
    }
  }

  const permissionMap = useMemo(() => {
    return PERMISSION_OPTIONS.reduce((map, option) => {
      map[option.key] = option;
      return map;
    }, {});
  }, []);

  const handleClose = () => {
    if (submitting) return;
    onClose();
    setForm(INITIAL_FORM);
    setCreateResult(null);
    setError('');
    setCopySuccess('');
  };

  const togglePermission = (permission) => {
    setForm((current) => {
      const exists = current.permissions.includes(permission);
      const nextPermissions = exists
        ? current.permissions.filter((item) => item !== permission)
        : [...current.permissions, permission];
      return { ...current, permissions: nextPermissions };
    });
  };

  const copyToken = async (text) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopySuccess('Token 已复制到剪贴板');
    } catch {
      setCopySuccess('复制失败，请手动复制');
    }
  };

  const handleSubmit = async () => {
    setError('');
    setCopySuccess('');

    if (!form.name.trim()) {
      setError('请输入 Token 名称');
      return;
    }

    if (form.permissions.length === 0) {
      setError('至少选择一项权限');
      return;
    }

    if (form.expiresMode === 'custom' && !form.expiresAt) {
      setError('请选择过期时间');
      return;
    }

    const result = await onSubmit({
      name: form.name.trim(),
      permissions: form.permissions,
      expiresMode: form.expiresMode,
      expiresAt: form.expiresMode === 'custom' ? form.expiresAt : null
    });

    if (result.success) {
      if (mode === 'create') {
        setCreateResult(result.data);
      } else {
        onClose();
      }
    } else {
      setError(result.error || `${mode === 'create' ? '创建' : '更新'}失败`);
    }
  };

  return (
    <Dialog open={open} onClose={handleClose} maxWidth="sm" fullWidth>
      <DialogTitle>
        {createResult ? 'Token 已创建' : (mode === 'edit' ? '编辑 API Token' : '创建 API Token')}
      </DialogTitle>
      <DialogContent dividers>
        {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
        {copySuccess && <Alert severity="success" sx={{ mb: 2 }}>{copySuccess}</Alert>}

        {mode === 'create' && createResult ? (
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            <Alert severity="success">Token 创建成功。该明文仅显示一次。</Alert>
            <TextField label="Token" value={createResult.plainToken || ''} fullWidth size="small" InputProps={{ readOnly: true }} />
            <Button variant="outlined" startIcon={<ContentCopyIcon />} onClick={() => copyToken(createResult.plainToken || '')}>
              复制 Token
            </Button>
            <TextField label="名称" value={createResult.name || ''} fullWidth size="small" InputProps={{ readOnly: true }} />
            <TextField
              label="权限"
              value={(createResult.permissions || []).map((permission) => permissionMap[permission]?.label || permission).join('、')}
              fullWidth
              size="small"
              InputProps={{ readOnly: true }}
            />
          </Box>
        ) : (
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            <TextField
              label="Token 名称"
              size="small"
              value={form.name}
              onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))}
              helperText="用于区分不同脚本或调用方"
            />

            <FormControl component="fieldset">
              <FormLabel component="legend">权限</FormLabel>
              <Box sx={{ display: 'flex', flexDirection: 'column', mt: 1 }}>
                {PERMISSION_OPTIONS.map((option) => (
                  <FormControlLabel
                    key={option.key}
                    control={(
                      <Checkbox
                        checked={form.permissions.includes(option.key)}
                        onChange={() => togglePermission(option.key)}
                      />
                    )}
                    label={`${option.label}：${option.description}`}
                  />
                ))}
              </Box>
            </FormControl>

            <FormControl>
              <FormLabel component="legend">有效期</FormLabel>
              <RadioGroup
                value={form.expiresMode}
                onChange={(event) => setForm((current) => ({ ...current, expiresMode: event.target.value }))}
              >
                <FormControlLabel value="never" control={<Radio />} label="永不过期" />
                <FormControlLabel value="custom" control={<Radio />} label="指定过期时间" />
              </RadioGroup>
            </FormControl>

            {form.expiresMode === 'custom' && (
              <TextField
                label="过期时间"
                type="datetime-local"
                size="small"
                value={form.expiresAt}
                onChange={(event) => setForm((current) => ({ ...current, expiresAt: event.target.value }))}
                slotProps={{ inputLabel: { shrink: true } }}
              />
            )}
          </Box>
        )}
      </DialogContent>
      <DialogActions>
        {createResult ? (
          <Button variant="contained" onClick={handleClose}>我已保存</Button>
        ) : (
          <>
            <Button onClick={handleClose} disabled={submitting}>取消</Button>
            <Button variant="contained" onClick={handleSubmit} disabled={submitting}>
              {submitting ? <CircularProgress size={18} color="inherit" /> : (mode === 'edit' ? '保存' : '创建')}
            </Button>
          </>
        )}
      </DialogActions>
    </Dialog>
  );
}
