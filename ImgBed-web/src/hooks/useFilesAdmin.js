import { useState, useEffect, useCallback, useRef } from 'react';
import { FileDocs, DirectoryDocs } from '../api';
import { useRefresh } from '../contexts/RefreshContext';
import { DEFAULT_PAGE_SIZE } from '../utils/constants';

const PAGE_SIZE = DEFAULT_PAGE_SIZE;

const EMPTY_LIST = { data: [], total: 0, hasMore: false, directories: [] };
const EMPTY_DELETE = { open: false, ids: [], label: '', saving: false };

/**
 * FilesAdmin 核心业务 Hook — 管理文件列表、目录、选择、删除、迁移等状态
 */
export function useFilesAdmin() {
  const { refreshTrigger } = useRefresh();

  const [listData, setListData] = useState(EMPTY_LIST);
  const [loading, setLoading] = useState(true);
  const [currentDir, setCurrentDir] = useState(null);
  const [selected, setSelected] = useState(new Set());
  const [error, setError] = useState(null);

  const [deleteDialog, setDeleteDialog] = useState(EMPTY_DELETE);
  const [migrateDialog, setMigrateDialog] = useState({ open: false, ids: [] });
  const [detailItem, setDetailItem] = useState(null);

  const pageRef = useRef(0);

  const handleOpenDetail = useCallback((item) => setDetailItem(item), []);
  const handleCloseDetail = useCallback(() => setDetailItem(null), []);

  const clearSelection = useCallback(() => setSelected(new Set()), []);

  const selectAll = useCallback(() => {
    setSelected(new Set(listData.data.map((d) => d.id)));
  }, [listData.data]);

  const resetDirectoryView = useCallback(() => {
    setListData(EMPTY_LIST);
    clearSelection();
    setError(null);
    pageRef.current = 0;
  }, [clearSelection]);

  const loadDirectoryData = useCallback(async ({ showLoading = false } = {}) => {
    if (showLoading) setLoading(true);
    resetDirectoryView();

    try {
      const [pageRes, dirsRes] = await Promise.all([
        (async () => {
          const params = { page: 1, pageSize: PAGE_SIZE };
          if (currentDir) params.directory = currentDir;
          return FileDocs.list(params);
        })(),
        DirectoryDocs.list({ type: 'flat' }),
      ]);

      const newList = { ...EMPTY_LIST };

      if (pageRes.code === 0 && pageRes.data) {
        const list = pageRes.data.list || [];
        newList.data = list;
        newList.total = pageRes.data.pagination?.total || 0;
        newList.hasMore = list.length < newList.total;
        pageRef.current = 1;
      }

      if (dirsRes.code === 0 && dirsRes.data) {
        const allDirs = dirsRes.data.list || dirsRes.data || [];
        const parentPath = currentDir || '/';
        const children = allDirs.filter((d) => {
          if (d.path === parentPath) return false;
          const prefix = parentPath === '/' ? '/' : `${parentPath}/`;
          if (!d.path.startsWith(prefix)) return false;
          const suffix = d.path.slice(prefix.length);
          return suffix.length > 0 && !suffix.includes('/');
        });
        children.sort((a, b) => a.name.localeCompare(b.name));
        newList.directories = children;
      }

      setListData(newList);
    } catch (err) {
      console.error('加载失败', err);
      setError('加载失败');
    } finally {
      if (showLoading) setLoading(false);
    }
  }, [currentDir, resetDirectoryView]);

  useEffect(() => {
    loadDirectoryData({ showLoading: true });
  }, [loadDirectoryData]);

  useEffect(() => {
    if (refreshTrigger > 0) loadDirectoryData();
  }, [refreshTrigger, loadDirectoryData]);

  const handleRefresh = useCallback(() => {
    loadDirectoryData({ showLoading: true });
  }, [loadDirectoryData]);

  const refreshAfterMutation = useCallback(() => {
    clearSelection();
    handleRefresh();
  }, [clearSelection, handleRefresh]);

  const toggleSelect = (id) => {
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const triggerDelete = (ids, label) => setDeleteDialog({ open: true, ids, label, saving: false });
  const closeDeleteDialog = () => {
    if (!deleteDialog.saving) setDeleteDialog(EMPTY_DELETE);
  };

  const confirmDelete = async () => {
    if (!deleteDialog.ids.length) return;
    setDeleteDialog((prev) => ({ ...prev, saving: true }));
    try {
      if (deleteDialog.ids.length === 1) {
        await FileDocs.delete(deleteDialog.ids[0]);
      } else {
        await FileDocs.batch({ action: 'delete', ids: deleteDialog.ids });
      }
      setDeleteDialog(EMPTY_DELETE);
      refreshAfterMutation();
    } catch (e) {
      console.error(e);
    } finally {
      setDeleteDialog((prev) => ({ ...prev, saving: false }));
    }
  };

  const navigateToDir = (path) => setCurrentDir(path || null);

  const openMigrate = () => setMigrateDialog({ open: true, ids: [...selected] });
  const closeMigrate = () => setMigrateDialog({ open: false, ids: [] });

  return {
    data: listData.data,
    total: listData.total,
    hasMore: listData.hasMore,
    directories: listData.directories,
    loading, currentDir, selected, error,
    deleteDialog,
    deleting: deleteDialog.saving,
    migrateDialog,
    detailOpen: detailItem !== null,
    selectedItem: detailItem,
    pageRef,
    handleOpenDetail, handleCloseDetail,
    clearSelection, selectAll,
    handleRefresh, refreshAfterMutation,
    toggleSelect,
    triggerDelete, closeDeleteDialog, confirmDelete,
    navigateToDir,
    openMigrate, closeMigrate,
  };
}
