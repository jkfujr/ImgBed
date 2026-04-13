import { useState, useEffect, useCallback, useRef } from 'react';
import { StorageDocs, SystemConfigDocs } from '../api';
import { createOverlayFocusManager } from '../utils/overlay-focus';

const EMPTY_EDIT = { open: false, target: null };
const EMPTY_DELETE = { target: null, saving: false };

/**
 * StorageChannelsPage 核心业务 Hook — 管理渠道列表、操作、弹窗状态
 */
export function useStorageChannels() {
  const [listData, setListData] = useState({ storages: [], defaultId: '', quotaStats: {}, stats: null });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const [editDialog, setEditDialog] = useState(EMPTY_EDIT);
  const [deleteState, setDeleteState] = useState(EMPTY_DELETE);
  const editDialogFocusManagerRef = useRef(null);
  const deleteDialogFocusManagerRef = useRef(null);

  if (!editDialogFocusManagerRef.current) {
    editDialogFocusManagerRef.current = createOverlayFocusManager();
  }

  if (!deleteDialogFocusManagerRef.current) {
    deleteDialogFocusManagerRef.current = createOverlayFocusManager();
  }

  const editDialogFocusManager = editDialogFocusManagerRef.current;
  const deleteDialogFocusManager = deleteDialogFocusManagerRef.current;

  const loadStorages = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [listRes, quotaRes, statsRes] = await Promise.all([
        StorageDocs.list(),
        SystemConfigDocs.quotaStats().catch(() => ({ code: -1, data: { stats: {} } })),
        StorageDocs.stats().catch(() => ({ code: -1, data: null }))
      ]);

      const newData = { storages: [], defaultId: '', quotaStats: {}, stats: null };

      if (listRes.code === 0) {
        newData.storages = listRes.data.list || [];
        newData.defaultId = listRes.data.default || '';
      } else {
        setError(listRes.message || '加载失败');
      }

      if (quotaRes.code === 0 && quotaRes.data) {
        newData.quotaStats = quotaRes.data.stats || {};
      }

      if (statsRes.code === 0 && statsRes.data) {
        newData.stats = statsRes.data;
      }

      setListData(newData);
    } catch {
      setError('网络错误，请检查后端服务');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadStorages(); }, [loadStorages]);

  const openEdit = (trigger, storage) => {
    editDialogFocusManager.open(trigger, () => setEditDialog({ open: true, target: storage }));
  };
  const closeDialog = () => editDialogFocusManager.close(() => setEditDialog(EMPTY_EDIT));

  const handleToggle = async (s) => {
    try {
      const res = await StorageDocs.toggle(s.id);
      if (res.code === 0) loadStorages();
    } catch { /* 忽略 */ }
  };

  const handleSetDefault = async (id) => {
    try {
      const res = await StorageDocs.setDefault(id);
      if (res.code === 0) loadStorages();
    } catch { /* 忽略 */ }
  };

  const handleDelete = async () => {
    if (!deleteState.target) return;
    setDeleteState((prev) => ({ ...prev, saving: true }));
    try {
      const res = await StorageDocs.remove(deleteState.target.id);
      if (res.code === 0) {
        deleteDialogFocusManager.close(() => setDeleteState(EMPTY_DELETE));
        loadStorages();
      }
    } catch { /* 忽略 */ } finally {
      setDeleteState((prev) => ({ ...prev, saving: false }));
    }
  };

  const clearError = () => setError(null);
  const openDeleteDialog = (trigger, target) => {
    deleteDialogFocusManager.open(trigger, () => setDeleteState({ target, saving: false }));
  };
  const closeDeleteDialog = () => deleteDialogFocusManager.close(() => setDeleteState(EMPTY_DELETE));

  const onDialogSuccess = () => {
    closeDialog();
    loadStorages();
  };

  return {
    storages: listData.storages,
    defaultId: listData.defaultId,
    quotaStats: listData.quotaStats,
    stats: listData.stats,
    loading, error,
    dialogOpen: editDialog.open,
    editTarget: editDialog.target,
    deleteTarget: deleteState.target,
    deleting: deleteState.saving,
    loadStorages, openEdit, closeDialog,
    handleToggle, handleSetDefault, handleDelete,
    openDeleteDialog, closeDeleteDialog, clearError, onDialogSuccess,
  };
}
