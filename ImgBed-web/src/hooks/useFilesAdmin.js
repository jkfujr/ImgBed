import { useState, useEffect, useCallback, useRef } from 'react';
import { FileDocs, DirectoryDocs } from '../api';
import { useRefresh } from '../contexts/RefreshContext';
import { DEFAULT_PAGE_SIZE } from '../utils/constants';
import logger from '../utils/logger';

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
  const cacheRef = useRef(new Map());

  const handleOpenDetail = useCallback((item) => setDetailItem(item), []);
  const handleCloseDetail = useCallback(() => setDetailItem(null), []);

  const clearSelection = useCallback(() => setSelected(new Set()), []);

  const selectAll = useCallback(() => {
    setSelected(new Set(listData.data.map((d) => d.id)));
  }, [listData.data]);

  const getCacheKey = useCallback((dir) => dir || '/', []);

  const buildDirectoryChildren = useCallback((allDirs, dir) => {
    const parentPath = dir || '/';
    return allDirs.filter((d) => {
      if (d.path === parentPath) return false;
      const prefix = parentPath === '/' ? '/' : `${parentPath}/`;
      if (!d.path.startsWith(prefix)) return false;
      const suffix = d.path.slice(prefix.length);
      return suffix.length > 0 && !suffix.includes('/');
    }).sort((a, b) => a.name.localeCompare(b.name));
  }, []);

  const fetchListPage = useCallback(async (dir) => {
    const params = { page: 1, pageSize: PAGE_SIZE };
    if (dir) params.directory = dir;
    const pageRes = await FileDocs.list(params);
    const list = pageRes.code === 0 && pageRes.data ? (pageRes.data.list || []) : [];
    const total = pageRes.code === 0 && pageRes.data ? (pageRes.data.pagination?.total || 0) : 0;
    return {
      data: list,
      total,
      hasMore: list.length < total,
    };
  }, []);

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

      let allDirs = null;
      let directories = [];

      if (keepDirectories && cached) {
        directories = cached.directories;
      } else {
        const dirsRes = await DirectoryDocs.list({ type: 'flat' });
        if (dirsRes.code === 0 && dirsRes.data) {
          allDirs = dirsRes.data.list || dirsRes.data || [];
          directories = buildDirectoryChildren(allDirs, currentDir);
        }
      }

      const listResult = await fetchListPage(currentDir);
      const newList = {
        data: listResult.data,
        total: listResult.total,
        hasMore: listResult.hasMore,
        directories,
      };

      setListData(newList);
      cacheRef.current.set(cacheKey, newList);
      pageRef.current = listResult.data.length > 0 ? 1 : 0;

      if (allDirs) {
        const cachedEntries = Array.from(cacheRef.current.entries());
        for (const [key, value] of cachedEntries) {
          const dir = key === '/' ? null : key;
          cacheRef.current.set(key, {
            ...value,
            directories: buildDirectoryChildren(allDirs, dir),
          });
        }
      }
    } catch (err) {
      logger.error('加载失败', err);
      setError('加载失败');
      setListData(EMPTY_LIST);
    } finally {
      if (showLoading) setLoading(false);
    }
  }, [buildDirectoryChildren, clearSelection, currentDir, fetchListPage, getCacheKey]);

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
      logger.error(e);
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
