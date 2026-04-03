import React, { useState, useMemo } from 'react';
import {
  Alert, Box, Button, Dialog, DialogActions, DialogContent, DialogTitle,
  FormControl, FormControlLabel, FormLabel, Radio, RadioGroup, Checkbox,
  TextField, Typography, CircularProgress
} from '@mui/material';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';

const PERMISSION_OPTIONS = [
  { key: 'upload:image', label: '上传图片', description: '允许调用上传接口', defaultChecked: true },
  { key: 'files:read', label: '查看文件列表', description: '允许读取文件列表与文件详情' }
];

export default function ApiTokenDialog({ open, onClose, onSubmit, submitting }) {
  const [form, setForm] = useState({
    name: '',
    permissions: ['upload:image'],
    expiresMode: 'never',
    expiresAt: ''
  });
  const [createResult, setCreateResult] = useState(null);
  const [error, setError] = useState('');
  const [copySuccess, setCopySuccess] = useState('');

  const permissionMap = useMemo(() => {
    return PERMISSION_OPTIONS.reduce((map, option) => {
      map[option.key] = option;
      return map;
    }, {});
  }, []);

  const resetForm = () => {
    setForm({
      name: '',
      permissions: ['upload:image'],
      expiresMode: 'never',
      expiresAt: ''
    });
    setCreateResult(null);
    setError('');
    setCopySuccess('');
  };

  const handleClose = () => {
    if (submitting) return;
    onClose();
    resetForm();
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

  const handleCreate = async () => {
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
      setCreateResult(result.data);
    } else {
      setError(result.error || '创建失败');
    }
  };

  return (
    <Dialog open={open} onClose={handleClose} maxWidth="sm" fullWidth>
      <DialogTitle>{createResult ? 'Token 已创建' : '创建 API Token'}</DialogTitle>
      <DialogContent dividers>
        {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
        {copySuccess && <Alert severity="success" sx={{ mb: 2 }}>{copySuccess}</Alert>}

        {createResult ? (
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
            <Button variant="contained" onClick={handleCreate} disabled={submitting}>
              {submitting ? <CircularProgress size={18} color="inherit" /> : '创建'}
            </Button>
          </>
        )}
      </DialogActions>
    </Dialog>
  );
}
