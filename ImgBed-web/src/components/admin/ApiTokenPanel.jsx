import { useEffect, useRef, useState } from 'react';
import { Alert, Box, Button, Typography } from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import { ApiTokenDocs } from '../../api';
import { createOverlayFocusManager } from '../../utils/overlay-focus';
import ConfirmDialog from '../common/ConfirmDialog';
import ApiTokenList from './ApiTokenList';
import ApiTokenDialog from './ApiTokenDialog';

export default function ApiTokenPanel() {
  const [tokens, setTokens] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [dialogOpen, setDialogOpen] = useState(false);
  const [dialogMode, setDialogMode] = useState('create');
  const [editTarget, setEditTarget] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [deleting, setDeleting] = useState(false);
  const createDialogFocusManagerRef = useRef(null);
  const deleteDialogFocusManagerRef = useRef(null);

  if (!createDialogFocusManagerRef.current) {
    createDialogFocusManagerRef.current = createOverlayFocusManager();
  }

  if (!deleteDialogFocusManagerRef.current) {
    deleteDialogFocusManagerRef.current = createOverlayFocusManager();
  }

  const createDialogFocusManager = createDialogFocusManagerRef.current;
  const deleteDialogFocusManager = deleteDialogFocusManagerRef.current;

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

  const handleEdit = (trigger, token) => {
    createDialogFocusManager.open(trigger, () => {
      setEditTarget(token);
      setDialogMode('edit');
      setDialogOpen(true);
    });
  };

  const handleUpdate = async (formData) => {
    setSubmitting(true);
    try {
      const res = await ApiTokenDocs.update(editTarget.id, formData);
      if (res.code === 0) {
        await loadTokens();
        return { success: true, data: res.data };
      }
      return { success: false, error: res.message || '更新失败' };
    } catch (err) {
      return { success: false, error: err.response?.data?.message || '更新失败' };
    } finally {
      setSubmitting(false);
    }
  };

  const handleDialogSubmit = async (formData) => {
    if (dialogMode === 'edit') {
      return await handleUpdate(formData);
    } else {
      return await handleCreate(formData);
    }
  };

  const handleDialogClose = () => {
    createDialogFocusManager.close(() => {
      setDialogOpen(false);
      setDialogMode('create');
      setEditTarget(null);
    });
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      const res = await ApiTokenDocs.remove(deleteTarget.id);
      if (res.code === 0) {
        deleteDialogFocusManager.close(() => setDeleteTarget(null));
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
        <Button
          variant="contained"
          startIcon={<AddIcon />}
          onClick={(event) => createDialogFocusManager.open(event.currentTarget, () => setDialogOpen(true))}
        >
          创建 Token
        </Button>
      </Box>

      <ApiTokenList
        tokens={tokens}
        loading={loading}
        onEdit={handleEdit}
        onDelete={(trigger, target) => deleteDialogFocusManager.open(trigger, () => setDeleteTarget(target))}
      />

      <ApiTokenDialog
        open={dialogOpen}
        mode={dialogMode}
        initialData={editTarget}
        onClose={handleDialogClose}
        onSubmit={handleDialogSubmit}
        submitting={submitting}
      />

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        title="删除 API Token"
        onClose={() => deleteDialogFocusManager.close(() => setDeleteTarget(null))}
        onConfirm={handleDelete}
        confirmLoading={deleting}
        confirmText="删除"
      >
        确认删除「{deleteTarget?.name || ''}」吗？删除后不可恢复。
      </ConfirmDialog>
    </Box>
  );
}
