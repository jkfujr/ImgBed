import { useEffect, useState } from 'react';
import { Alert, Box, Button, Typography } from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import { ApiTokenDocs } from '../../api';
import ConfirmDialog from '../common/ConfirmDialog';
import ApiTokenList from './ApiTokenList';
import ApiTokenDialog from './ApiTokenDialog';

export default function ApiTokenPanel() {
  const [tokens, setTokens] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [dialogOpen, setDialogOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [deleting, setDeleting] = useState(false);

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

  const handleCreate = async (formData) => {
    setSubmitting(true);
    try {
      const res = await ApiTokenDocs.create(formData);
      if (res.code === 0) {
        await loadTokens();
        return { success: true, data: res.data };
      }
      return { success: false, error: res.message || '创建失败' };
    } catch (err) {
      return { success: false, error: err.response?.data?.message || '创建失败' };
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

      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 2, flexWrap: 'wrap' }}>
        <Box>
          <Typography variant="subtitle1" fontWeight="bold">API Token 列表</Typography>
          <Typography variant="body2" color="text.secondary">当前共 {tokens.length} 个 Token</Typography>
        </Box>
        <Button variant="contained" startIcon={<AddIcon />} onClick={() => setDialogOpen(true)}>
          创建 Token
        </Button>
      </Box>

      <ApiTokenList tokens={tokens} loading={loading} onDelete={setDeleteTarget} />

      <ApiTokenDialog
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        onSubmit={handleCreate}
        submitting={submitting}
      />

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
