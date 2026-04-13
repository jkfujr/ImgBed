import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { FileDocs } from '../api';
import { useRefresh } from '../contexts/RefreshContext';
import logger from '../utils/logger';
import { createRequestGuard } from '../utils/request-guard';
import { createOverlayFocusManager } from '../utils/overlay-focus';
import {
  EMPTY_DELETE,
  EMPTY_LIST,
  areAllTelegramFilesOlderThan24h,
  buildFilesAdminPath,
  fetchDirectories,
  fetchListPage,
  getCacheKey,
  getDirectoryPathFromSearch,
  loadFilesAdminPageData,
  normalizeDirectoryPath,
  updateCachedDirectories,
} from '../admin/filesAdminShared';

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
  const deleteDialogFocusManagerRef = useRef(null);
  const migrateDialogFocusManagerRef = useRef(null);
  const moveDialogFocusManagerRef = useRef(null);
  const detailDialogFocusManagerRef = useRef(null);

  const pageRef = useRef(0);
  const cacheRef = useRef(new Map());
  const requestGuardRef = useRef(createRequestGuard());
  const currentDir = useMemo(() => getDirectoryPathFromSearch(location.search), [location.search]);

  if (!deleteDialogFocusManagerRef.current) {
    deleteDialogFocusManagerRef.current = createOverlayFocusManager();
  }

  if (!migrateDialogFocusManagerRef.current) {
    migrateDialogFocusManagerRef.current = createOverlayFocusManager();
  }

  if (!moveDialogFocusManagerRef.current) {
    moveDialogFocusManagerRef.current = createOverlayFocusManager();
  }

  if (!detailDialogFocusManagerRef.current) {
    detailDialogFocusManagerRef.current = createOverlayFocusManager();
  }

  const deleteDialogFocusManager = deleteDialogFocusManagerRef.current;
  const migrateDialogFocusManager = migrateDialogFocusManagerRef.current;
  const moveDialogFocusManager = moveDialogFocusManagerRef.current;
  const detailDialogFocusManager = detailDialogFocusManagerRef.current;

  const handleOpenDetail = useCallback((trigger, item) => {
    detailDialogFocusManager.open(trigger, () => setDetailItem(item));
  }, [detailDialogFocusManager]);
  const handleCloseDetail = useCallback((options) => {
    detailDialogFocusManager.close(() => setDetailItem(null), options);
  }, [detailDialogFocusManager]);
  const clearSelection = useCallback(() => setSelected(new Set()), []);

  const selectAll = useCallback(() => {
    setSelected(new Set(listData.data.map((item) => item.id)));
  }, [listData.data]);

  const loadDirectoryData = useCallback(async ({
    showLoading = false,
    forceReload = false,
    keepDirectories = false,
  } = {}) => {
    const requestId = requestGuardRef.current.begin();

    if (showLoading) {
      setLoading(true);
    }
    clearSelection();
    setError(null);
    pageRef.current = 0;

    const cacheKey = getCacheKey(currentDir);
    const cached = cacheRef.current.get(cacheKey);

    try {
      if (!forceReload && cached) {
        if (requestGuardRef.current.isCurrent(requestId)) {
          setListData(cached);
          pageRef.current = cached.data.length > 0 ? 1 : 0;
        }
        return;
      }

      const { nextList, allDirs } = await loadFilesAdminPageData({
        currentDir,
        cached,
        keepDirectories,
        fetchDirectoriesImpl: fetchDirectories,
        fetchListPageImpl: fetchListPage,
        loggerImpl: logger,
      });

      if (!requestGuardRef.current.isCurrent(requestId)) {
        return;
      }

      setListData(nextList);
      cacheRef.current.set(cacheKey, nextList);
      pageRef.current = nextList.data.length > 0 ? 1 : 0;

      if (allDirs) {
        updateCachedDirectories(cacheRef.current, allDirs);
      }
    } catch (err) {
      if (!requestGuardRef.current.isCurrent(requestId)) {
        return;
      }

      logger.error('加载文件列表失败', err);
      setError('加载失败');
      setListData(EMPTY_LIST);
    } finally {
      if (requestGuardRef.current.isCurrent(requestId)) {
        setLoading(false);
      }
    }
  }, [clearSelection, currentDir]);

  useEffect(() => {
    return () => {
      requestGuardRef.current.dispose();
    };
  }, []);

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
    if (refreshTrigger > 0) {
      loadDirectoryData({ forceReload: true });
    }
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
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const triggerDelete = useCallback((trigger, ids, label, items = []) => {
    if (deleteDialog.open || !ids.length) {
      return;
    }

    const effectiveMode = areAllTelegramFilesOlderThan24h(items) ? 'index_only' : 'remote_and_index';
    deleteDialogFocusManager.open(trigger, () => {
      setDeleteDialog({ open: true, ids, label, saving: false, deleteMode: effectiveMode, errorMessage: '' });
    });
  }, [deleteDialog.open, deleteDialogFocusManager]);

  const closeDeleteDialog = useCallback(() => {
    if (!deleteDialog.saving) {
      deleteDialogFocusManager.close(() => setDeleteDialog(EMPTY_DELETE));
    }
  }, [deleteDialog.saving, deleteDialogFocusManager]);

  const confirmDelete = async () => {
    if (!deleteDialog.ids.length) {
      return;
    }

    setDeleteDialog((prev) => ({ ...prev, saving: true }));

    try {
      const { ids, deleteMode } = deleteDialog;
      if (ids.length === 1) {
        await FileDocs.delete(ids[0], deleteMode);
      } else {
        await FileDocs.batch({ action: 'delete', ids, delete_mode: deleteMode });
      }
      deleteDialogFocusManager.close(() => setDeleteDialog(EMPTY_DELETE));
      refreshAfterMutation();
    } catch (error) {
      logger.error(error);
      setDeleteDialog((prev) => ({ ...prev, saving: false, errorMessage: '删除失败，请重试' }));
    }
  };

  const navigateToDir = useCallback((path) => {
    const normalized = normalizeDirectoryPath(path);
    navigate(buildFilesAdminPath(normalized));
  }, [navigate]);

  const openMigrate = useCallback((trigger) => {
    migrateDialogFocusManager.open(trigger, () => setMigrateDialog({ open: true, ids: [...selected] }));
  }, [migrateDialogFocusManager, selected]);
  const closeMigrate = useCallback(() => {
    migrateDialogFocusManager.close(() => setMigrateDialog({ open: false, ids: [] }));
  }, [migrateDialogFocusManager]);
  const openMove = useCallback((trigger) => {
    moveDialogFocusManager.open(trigger, () => setMoveDialog({ open: true, ids: [...selected] }));
  }, [moveDialogFocusManager, selected]);
  const closeMove = useCallback(() => {
    moveDialogFocusManager.close(() => setMoveDialog({ open: false, ids: [] }));
  }, [moveDialogFocusManager]);

  const triggerDeleteFromDetail = useCallback((trigger, ids, label, items = []) => {
    handleCloseDetail({ restoreFocus: false });
    globalThis.setTimeout(() => {
      triggerDelete(trigger, ids, label, items);
    }, 0);
  }, [handleCloseDetail, triggerDelete]);

  return {
    data: listData.data,
    total: listData.total,
    hasMore: listData.hasMore,
    directories: listData.directories,
    loading,
    currentDir,
    selected,
    error,
    deleteDialog,
    deleting: deleteDialog.saving,
    migrateDialog,
    moveDialog,
    detailOpen: detailItem !== null,
    selectedItem: detailItem,
    pageRef,
    handleOpenDetail,
    handleCloseDetail,
    triggerDeleteFromDetail,
    clearSelection,
    selectAll,
    handleRefresh,
    refreshAfterMutation,
    toggleSelect,
    triggerDelete,
    closeDeleteDialog,
    confirmDelete,
    navigateToDir,
    openMigrate,
    closeMigrate,
    openMove,
    closeMove,
  };
}
