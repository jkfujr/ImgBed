import React, { useEffect, useMemo, useState } from 'react';
import {
  Alert, Box, Button, Chip, Dialog, DialogActions, DialogContent, DialogTitle,
  FormControl, FormControlLabel, FormLabel, Radio, RadioGroup, Checkbox,
  TextField, Typography, CircularProgress, IconButton, Tooltip, Stack,
  Table, TableBody, TableCell, TableHead, TableRow, Paper
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import DeleteIcon from '@mui/icons-material/Delete';
import { ApiTokenDocs } from '../../api';
import ConfirmDialog from '../common/ConfirmDialog';
import { BORDER_RADIUS } from '../../utils/constants';

const PERMISSION_OPTIONS = [
  { key: 'upload:image', label: '上传图片', description: '允许调用上传接口', defaultChecked: true },
  { key: 'files:read', label: '查看文件列表', description: '允许读取文件列表与文件详情' }
];

const formatDateTime = (value) => {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString('zh-CN', { hour12: false });
};

export default function ApiTokenPanel() {
  const [tokens, setTokens] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [dialogOpen, setDialogOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [deleting, setDeleting] = useState(false);
  const [copySuccess, setCopySuccess] = useState('');
  const [form, setForm] = useState({
    name: '',
    permissions: ['upload:image'],
    expiresMode: 'never',
    expiresAt: ''
  });
  const [createResult, setCreateResult] = useState(null);

  const permissionMap = useMemo(() => {
    return PERMISSION_OPTIONS.reduce((map, option) => {
      map[option.key] = option;
      return map;
    }, {});
  }, []);

  const loadTokens = async () => {
    setLoading(true);
    setError('');
    try {
      const res = await ApiTokenDocs.list();
      if (res.code === 0) {
        setTokens(res.data || []);
      } else {
        setError(res.message || '加载 API Token 失败');
      }
    } catch (err) {
      setError(err.response?.data?.message || '加载 API Token 失败');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadTokens();
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

  const openCreateDialog = () => {
    resetForm();
    setDialogOpen(true);
  };

  const closeCreateDialog = () => {
    if (submitting) return;
    setDialogOpen(false);
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

    setSubmitting(true);
    try {
      const res = await ApiTokenDocs.create({
        name: form.name.trim(),
        permissions: form.permissions,
        expiresMode: form.expiresMode,
        expiresAt: form.expiresMode === 'custom' ? form.expiresAt : null
      });

      if (res.code === 0) {
        setCreateResult(res.data);
        await loadTokens();
      } else {
        setError(res.message || '创建失败');
      }
    } catch (err) {
      setError(err.response?.data?.message || '创建失败');
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      const res = await ApiTokenDocs.remove(deleteTarget.id);
      if (res.code === 0) {
        setDeleteTarget(null);
        await loadTokens();
      } else {
        setError(res.message || '删除失败');
      }
    } catch (err) {
      setError(err.response?.data?.message || '删除失败');
    } finally {
      setDeleting(false);
    }
  };

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2.5 }}>
      <Alert severity="info">
        API Token 适用于脚本或第三方调用。完整 Token 仅在创建成功后显示一次，请立即复制并妥善保存。
      </Alert>

      {error && <Alert severity="error" onClose={() => setError('')}>{error}</Alert>}
      {copySuccess && <Alert severity="success" onClose={() => setCopySuccess('')}>{copySuccess}</Alert>}

      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 2, flexWrap: 'wrap' }}>
        <Box>
          <Typography variant="subtitle1" fontWeight="bold">API Token 列表</Typography>
          <Typography variant="body2" color="text.secondary">当前共 {tokens.length} 个 Token</Typography>
        </Box>
        <Button variant="contained" startIcon={<AddIcon />} onClick={openCreateDialog}>
          创建 Token
        </Button>
      </Box>

      <Paper variant="outlined" sx={{ borderRadius: BORDER_RADIUS.md, overflow: 'hidden' }}>
        {loading ? (
          <Box sx={{ display: 'flex', justifyContent: 'center', py: 5 }}>
            <CircularProgress size={28} />
          </Box>
        ) : tokens.length === 0 ? (
          <Box sx={{ py: 5, textAlign: 'center' }}>
            <Typography color="text.secondary">暂无 API Token</Typography>
          </Box>
        ) : (
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>名称</TableCell>
                <TableCell>前缀</TableCell>
                <TableCell>权限</TableCell>
                <TableCell>过期时间</TableCell>
                <TableCell>最后使用</TableCell>
                <TableCell>创建时间</TableCell>
                <TableCell align="right">操作</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {tokens.map((token) => (
                <TableRow key={token.id} hover>
                  <TableCell>
                    <Stack spacing={0.5}>
                      <Typography variant="body2" fontWeight="medium">{token.name}</Typography>
                      <Typography variant="caption" color="text.secondary">
                        {token.is_expired ? '已过期' : '生效中'}
                      </Typography>
                    </Stack>
                  </TableCell>
                  <TableCell>{token.token_prefix}</TableCell>
                  <TableCell>
                    <Stack direction="row" spacing={0.5} useFlexGap flexWrap="wrap">
                      {(token.permissions || []).map((permission) => (
                        <Chip
                          key={permission}
                          size="small"
                          label={permissionMap[permission]?.label || permission}
                          variant="outlined"
                        />
                      ))}
                    </Stack>
                  </TableCell>
                  <TableCell>{token.expires_at ? formatDateTime(token.expires_at) : '永不过期'}</TableCell>
                  <TableCell>{formatDateTime(token.last_used_at)}</TableCell>
                  <TableCell>{formatDateTime(token.created_at)}</TableCell>
                  <TableCell align="right">
                    <Tooltip title="删除">
                      <IconButton color="error" size="small" onClick={() => setDeleteTarget(token)}>
                        <DeleteIcon fontSize="small" />
                      </IconButton>
                    </Tooltip>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Paper>

      <Dialog open={dialogOpen} onClose={closeCreateDialog} maxWidth="sm" fullWidth>
        <DialogTitle>{createResult ? 'Token 已创建' : '创建 API Token'}</DialogTitle>
        <DialogContent dividers>
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
            <Button variant="contained" onClick={closeCreateDialog}>我已保存</Button>
          ) : (
            <>
              <Button onClick={closeCreateDialog} disabled={submitting}>取消</Button>
              <Button variant="contained" onClick={handleCreate} disabled={submitting}>
                {submitting ? <CircularProgress size={18} color="inherit" /> : '创建'}
              </Button>
            </>
          )}
        </DialogActions>
      </Dialog>

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        title="删除 API Token"
        onClose={() => setDeleteTarget(null)}
        onConfirm={handleDelete}
        confirmLoading={deleting}
        confirmText="删除"
      >
        确认删除「{deleteTarget?.name || ''}」吗？删除后不可恢复。
      </ConfirmDialog>
    </Box>
  );
}
