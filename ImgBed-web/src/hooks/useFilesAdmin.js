import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { FileDocs } from '../api';
import { useRefresh } from '../contexts/RefreshContext';
import logger from '../utils/logger';
import { createRequestGuard } from '../utils/request-guard';
import { createOverlayFocusManager } from '../utils/overlay-focus';
import { useUserPreference } from './useUserPreference';
import {
  EMPTY_DELETE,
  EMPTY_LIST,
  areAllTelegramFilesOlderThan24h,
  buildDirectoryChildren,
  buildFilesAdminPath,
  fetchListPage,
  getDirectoryPathFromSearch,
  loadFilesAdminPageData,
  normalizeDirectoryPath,
} from '../admin/filesAdminShared';
import {
  buildFilesPageCacheKey,
  createFilesListState,
  flattenFilesPages,
  normalizeFilesPageSize,
} from '../admin/filesAdminPagination';

export function useFilesAdmin(viewMode = 'masonry') {
  const { refreshTrigger } = useRefresh();
  const location = useLocation();
  const navigate = useNavigate();
  const [prefPageSize] = useUserPreference('pref_page_size', '20');

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

  const pageCacheRef = useRef(new Map());
  const allDirsRef = useRef(null);
  const requestGuardRef = useRef(createRequestGuard());
  const currentDir = useMemo(() => getDirectoryPathFromSearch(location.search), [location.search]);
  const searchQuery = useMemo(() => {
    const params = new URLSearchParams(location.search);
    return params.get('search') || '';
  }, [location.search]);
  const pageSize = useMemo(() => normalizeFilesPageSize(prefPageSize), [prefPageSize]);

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

  const buildPageCacheKey = useCallback((page) => {
    return buildFilesPageCacheKey(currentDir, pageSize, page, searchQuery);
  }, [currentDir, pageSize, searchQuery]);

  const getCachedPage = useCallback((page) => {
    return pageCacheRef.current.get(buildPageCacheKey(page)) || null;
  }, [buildPageCacheKey]);

  const cachePage = useCallback((pageResult) => {
    pageCacheRef.current.set(buildPageCacheKey(pageResult.page), pageResult);
  }, [buildPageCacheKey]);

  const clearDirectoryPageCache = useCallback((directory = currentDir) => {
    const prefix = `${directory}::`;
    for (const key of pageCacheRef.current.keys()) {
      if (key.startsWith(prefix)) {
        pageCacheRef.current.delete(key);
      }
    }
  }, [currentDir]);

  const resolveDirectories = useCallback(() => {
    if (!Array.isArray(allDirsRef.current)) {
      return [];
    }
    return buildDirectoryChildren(allDirsRef.current, currentDir);
  }, [currentDir]);

  const buildListState = useCallback(({
    pageResult,
    directories,
    currentPage = 1,
    loadedPageCount = 0,
  }) => {
    return createFilesListState({
      pageData: pageResult?.data || [],
      masonryData: flattenFilesPages(pageCacheRef.current, currentDir, pageSize, loadedPageCount, searchQuery),
      directories,
      total: pageResult?.total || 0,
      currentPage,
      loadedPageCount,
      pageSize,
    });
  }, [currentDir, pageSize, searchQuery]);

  const selectAll = useCallback(() => {
    const currentItems = viewMode === 'masonry' ? listData.masonryData : listData.pageData;
    setSelected(new Set(currentItems.map((item) => item.id)));
  }, [listData.masonryData, listData.pageData, viewMode]);

  const loadDirectoryData = useCallback(async ({
    showLoading = false,
    forceReload = false,
    reuseDirectories = true,
  } = {}) => {
    const requestId = requestGuardRef.current.begin();

    if (showLoading) {
      setLoading(true);
    }
    clearSelection();
    setError(null);

    try {
      if (forceReload) {
        clearDirectoryPageCache(currentDir);
      }

      const cachedPage = !forceReload ? getCachedPage(1) : null;
      let directories = [];
      let pageResult = cachedPage;

      if (cachedPage && reuseDirectories && Array.isArray(allDirsRef.current)) {
        directories = resolveDirectories();
      } else {
        const { nextPage, directories: nextDirectories, allDirs } = await loadFilesAdminPageData({
          currentDir,
          page: 1,
          pageSize,
          search: searchQuery,
          keepDirectories: reuseDirectories && Array.isArray(allDirsRef.current),
          cachedDirectories: allDirsRef.current,
          fetchListPageImpl: async (dir, options) => cachedPage || fetchListPage(dir, options),
          loggerImpl: logger,
        });

        pageResult = nextPage;
        directories = nextDirectories;
        if (Array.isArray(allDirs)) {
          allDirsRef.current = allDirs;
        }
      }

      if (!requestGuardRef.current.isCurrent(requestId)) {
        return;
      }

      if (!pageResult) {
        pageResult = await fetchListPage(currentDir, { page: 1, pageSize, search: searchQuery });
      }

      cachePage(pageResult);

      if (!directories.length && Array.isArray(allDirsRef.current)) {
        directories = resolveDirectories();
      }

      const loadedPageCount = pageResult.data.length > 0 ? 1 : 0;
      setListData(buildListState({
        pageResult,
        directories,
        currentPage: 1,
        loadedPageCount,
      }));
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
  }, [
    buildListState,
    cachePage,
    clearDirectoryPageCache,
    clearSelection,
    currentDir,
    getCachedPage,
    pageSize,
    resolveDirectories,
    searchQuery,
  ]);

  const goToPage = useCallback(async (page) => {
    const nextPageNumber = Number(page);
    if (!Number.isInteger(nextPageNumber) || nextPageNumber < 1 || nextPageNumber === listData.currentPage) {
      return;
    }

    const requestId = requestGuardRef.current.begin();
    setLoading(true);
    clearSelection();
    setError(null);

    try {
      let pageResult = getCachedPage(nextPageNumber);
      if (!pageResult) {
        pageResult = await fetchListPage(currentDir, { page: nextPageNumber, pageSize, search: searchQuery });
        cachePage(pageResult);
      }

      let directories = resolveDirectories();
      if (!directories.length && listData.directories.length > 0) {
        directories = listData.directories;
      }

      if (!requestGuardRef.current.isCurrent(requestId)) {
        return;
      }

      setListData(buildListState({
        pageResult,
        directories,
        currentPage: nextPageNumber,
        loadedPageCount: listData.loadedPageCount,
      }));
    } catch (err) {
      if (!requestGuardRef.current.isCurrent(requestId)) {
        return;
      }

      logger.error('切换文件分页失败', err);
      setError('加载失败');
    } finally {
      if (requestGuardRef.current.isCurrent(requestId)) {
        setLoading(false);
      }
    }
  }, [
    buildListState,
    cachePage,
    clearSelection,
    currentDir,
    getCachedPage,
    listData.currentPage,
    listData.directories,
    listData.loadedPageCount,
    pageSize,
    resolveDirectories,
    searchQuery,
  ]);

  const loadNextPage = useCallback(async () => {
    if (loading || !listData.hasMore) {
      return;
    }

    const nextPageNumber = listData.loadedPageCount + 1;
    if (nextPageNumber < 1) {
      return;
    }

    const requestId = requestGuardRef.current.begin();
    setLoading(true);
    setError(null);

    try {
      let pageResult = getCachedPage(nextPageNumber);
      if (!pageResult) {
        pageResult = await fetchListPage(currentDir, { page: nextPageNumber, pageSize, search: searchQuery });
        cachePage(pageResult);
      }

      const directories = listData.directories.length > 0 ? listData.directories : resolveDirectories();

      if (!requestGuardRef.current.isCurrent(requestId)) {
        return;
      }

      const currentPageResult = getCachedPage(listData.currentPage) || {
        data: listData.pageData,
        total: pageResult.total,
        page: listData.currentPage,
        pageSize,
      };

      setListData(buildListState({
        pageResult: currentPageResult,
        directories,
        currentPage: listData.currentPage,
        loadedPageCount: nextPageNumber,
      }));
    } catch (err) {
      if (!requestGuardRef.current.isCurrent(requestId)) {
        return;
      }

      logger.error('加载更多文件失败', err);
      setError('加载失败');
    } finally {
      if (requestGuardRef.current.isCurrent(requestId)) {
        setLoading(false);
      }
    }
  }, [
    buildListState,
    cachePage,
    currentDir,
    getCachedPage,
    listData.currentPage,
    listData.directories,
    listData.hasMore,
    listData.loadedPageCount,
    listData.pageData,
    loading,
    pageSize,
    resolveDirectories,
    searchQuery,
  ]);

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
    loadDirectoryData({ showLoading: true, reuseDirectories: true });
  }, [loadDirectoryData]);

  useEffect(() => {
    if (refreshTrigger > 0) {
      loadDirectoryData({ showLoading: true, forceReload: true, reuseDirectories: false });
    }
  }, [refreshTrigger, loadDirectoryData]);

  const handleRefresh = useCallback(() => {
    loadDirectoryData({ showLoading: true, forceReload: true, reuseDirectories: false });
  }, [loadDirectoryData]);

  const refreshAfterMutation = useCallback(() => {
    loadDirectoryData({ showLoading: true, forceReload: true, reuseDirectories: true });
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

  const clearSearch = useCallback(() => {
    navigate(buildFilesAdminPath(currentDir));
  }, [navigate, currentDir]);

  return {
    masonryData: listData.masonryData,
    pageData: listData.pageData,
    total: listData.total,
    totalPages: listData.totalPages,
    currentPage: listData.currentPage,
    loadedPageCount: listData.loadedPageCount,
    hasMore: listData.hasMore,
    directories: listData.directories,
    pageSize,
    loading,
    currentDir,
    searchQuery,
    selected,
    error,
    deleteDialog,
    deleting: deleteDialog.saving,
    migrateDialog,
    moveDialog,
    detailOpen: detailItem !== null,
    selectedItem: detailItem,
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
    loadNextPage,
    goToPage,
    clearSearch,
  };
}
