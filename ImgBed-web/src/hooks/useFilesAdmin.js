import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { FileDocs } from '../api';
import { useRefresh } from '../contexts/RefreshContext';
import logger from '../utils/logger';
import {
  EMPTY_DELETE,
  EMPTY_LIST,
  ROOT_DIR,
  areAllTelegramFilesOlderThan24h,
  buildFilesAdminPath,
  fetchDirectories,
  fetchListPage,
  getCacheKey,
  getDirectoryPathFromSearch,
  normalizeDirectoryPath,
  updateCachedDirectories,
} from '../admin/filesAdminShared';

/**
 * FilesAdmin 核心业务 Hook — 管理文件列表、目录、选择、删除、迁移等状态
 */
export function useFilesAdmin() {
  const { refreshTrigger } = useRefresh();
  const location = useLocation();
  const navigate = useNavigate();

  const [listData, setListData] = useState(EMPTY_LIST);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState(new Set());
  const [error, setError] = useState(null);
  const [deleteDialog, setDeleteDialog] = useState(EMPTY_DELETE);
  const [migrateDialog, setMigrateDialog] = useState({ open: false, ids: [] });
  const [moveDialog, setMoveDialog] = useState({ open: false, ids: [] });
  const [detailItem, setDetailItem] = useState(null);

  const pageRef = useRef(0);
  const cacheRef = useRef(new Map());
  const currentDir = useMemo(() => getDirectoryPathFromSearch(location.search), [location.search]);

  const handleOpenDetail = useCallback((item) => setDetailItem(item), []);
  const handleCloseDetail = useCallback(() => setDetailItem(null), []);
  const clearSelection = useCallback(() => setSelected(new Set()), []);

  const selectAll = useCallback(() => {
    setSelected(new Set(listData.data.map((item) => item.id)));
  }, [listData.data]);

  const loadDirectoryData = useCallback(async ({
    showLoading = false,
    forceReload = false,
    keepDirectories = false,
  } = {}) => {
    if (showLoading) setLoading(true);
    clearSelection();
    setError(null);
    pageRef.current = 0;

    const cacheKey = getCacheKey(currentDir);
    const cached = cacheRef.current.get(cacheKey);

    try {
      if (!forceReload && cached) {
        setListData(cached);
        pageRef.current = cached.data.length > 0 ? 1 : 0;
        return;
      }

      const directoryResult = keepDirectories && cached
        ? { allDirs: null, directories: cached.directories }
        : await fetchDirectories(currentDir);

      const listResult = await fetchListPage(currentDir);
      const nextList = {
        data: listResult.data,
        total: listResult.total,
        hasMore: listResult.hasMore,
        directories: directoryResult.directories,
      };

      setListData(nextList);
      cacheRef.current.set(cacheKey, nextList);
      pageRef.current = listResult.data.length > 0 ? 1 : 0;

      if (directoryResult.allDirs) {
        updateCachedDirectories(cacheRef.current, directoryResult.allDirs);
      }
    } catch (err) {
      logger.error('加载失败', err);
      setError('加载失败');
      setListData(EMPTY_LIST);
    } finally {
      if (showLoading) setLoading(false);
    }
  }, [clearSelection, currentDir]);

  useEffect(() => {
    const normalizedPath = getDirectoryPathFromSearch(location.search);
    const pathParam = new URLSearchParams(location.search).get('path');
    if (pathParam !== normalizedPath) {
      navigate(buildFilesAdminPath(normalizedPath), { replace: true });
    }
  }, [location.search, navigate]);

  useEffect(() => {
    loadDirectoryData({ showLoading: true });
  }, [loadDirectoryData]);

  useEffect(() => {
    if (refreshTrigger > 0) loadDirectoryData({ forceReload: true });
  }, [refreshTrigger, loadDirectoryData]);

  const handleRefresh = useCallback(() => {
    loadDirectoryData({ showLoading: true, forceReload: true });
  }, [loadDirectoryData]);

  const refreshAfterMutation = useCallback(() => {
    loadDirectoryData({ showLoading: true, forceReload: true, keepDirectories: true });
  }, [loadDirectoryData]);

  const toggleSelect = (id) => {
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const triggerDelete = (ids, label, items = []) => {
    if (deleteDialog.open || !ids.length) return;
    const effectiveMode = areAllTelegramFilesOlderThan24h(items) ? 'index_only' : 'remote_and_index';
    setDeleteDialog({ open: true, ids, label, saving: false, deleteMode: effectiveMode, errorMessage: '' });
  };

  const closeDeleteDialog = () => {
    if (!deleteDialog.saving) setDeleteDialog(EMPTY_DELETE);
  };

  const confirmDelete = async () => {
    if (!deleteDialog.ids.length) return;
    setDeleteDialog((prev) => ({ ...prev, saving: true }));
    try {
      const { ids, deleteMode } = deleteDialog;
      if (ids.length === 1) {
        await FileDocs.delete(ids[0], deleteMode);
      } else {
        await FileDocs.batch({ action: 'delete', ids, delete_mode: deleteMode });
      }
      setDeleteDialog(EMPTY_DELETE);
      refreshAfterMutation();
    } catch (e) { 
      logger.error(e);
      setDeleteDialog((prev) => ({ ...prev, saving: false, errorMessage: '删除失败，请重试' }));
    }
  };

  const navigateToDir = useCallback((path) => {
    const normalized = normalizeDirectoryPath(path);
    navigate(buildFilesAdminPath(normalized));
  }, [navigate]);

  const openMigrate = () => setMigrateDialog({ open: true, ids: [...selected] });
  const closeMigrate = () => setMigrateDialog({ open: false, ids: [] });
  const openMove = () => setMoveDialog({ open: true, ids: [...selected] });
  const closeMove = () => setMoveDialog({ open: false, ids: [] });

  return {
    data: listData.data,
    total: listData.total,
    hasMore: listData.hasMore,
    directories: listData.directories,
    loading, currentDir, selected, error,
    deleteDialog, deleting: deleteDialog.saving,
    migrateDialog,
    moveDialog,
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
    openMove, closeMove,
  };
}
