import { useEffect, useState, useCallback, useRef } from 'react';
import { Box, Alert, useTheme, useMediaQuery } from '@mui/material';
import FilesAdminToolbar from '../../components/admin/FilesAdminToolbar';
import FilesAdminSelectionBar from '../../components/admin/FilesAdminSelectionBar';
import FilesAdminContent from '../../components/admin/FilesAdminContent';
import FilesAdminMigrateDialog from '../../components/admin/FilesAdminMigrateDialog';
import ImageDetailLightbox from '../../components/admin/ImageDetailLightbox';
import ConfirmDialog from '../../components/common/ConfirmDialog';
import { useUserPreference } from '../../hooks/useUserPreference';
import { FileDocs, DirectoryDocs } from '../../api';
import { useRefresh } from '../../contexts/RefreshContext';
import { DEFAULT_PAGE_SIZE } from '../../utils/constants';

const PAGE_SIZE = DEFAULT_PAGE_SIZE;

export default function FilesAdmin() {
  const { refreshTrigger } = useRefresh();
  const theme = useTheme();
  const isXl = useMediaQuery(theme.breakpoints.up('xl'));
  const isLg = useMediaQuery(theme.breakpoints.up('lg'));
  const isMd = useMediaQuery(theme.breakpoints.up('md'));
  const [prefCols] = useUserPreference('pref_masonry_cols', '0');
  const autoCols = isXl ? 5 : isLg ? 4 : isMd ? 3 : 2;
  const cols = parseInt(prefCols, 10) > 0 ? parseInt(prefCols, 10) : autoCols;

  const [viewMode, setViewMode] = useUserPreference('pref_view_mode', 'masonry');
  const [data, setData] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [hasMore, setHasMore] = useState(false);
  const [directories, setDirectories] = useState([]);
  const [currentDir, setCurrentDir] = useState(null);
  const [selected, setSelected] = useState(new Set());
  const [deleteDialog, setDeleteDialog] = useState({ open: false, ids: [], label: '' });
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState(null);
  const [pathEditing, setPathEditing] = useState(false);
  const [pathInput, setPathInput] = useState('');
  const pathInputRef = useRef(null);
  const pageRef = useRef(0);
  const sentinelRef = useRef(null);

  const [migrateDialog, setMigrateDialog] = useState({ open: false, ids: [] });

  const [detailOpen, setDetailOpen] = useState(false);
  const [selectedItem, setSelectedItem] = useState(null);

  const handleOpenDetail = useCallback((item) => {
    setSelectedItem(item);
    setDetailOpen(true);
  }, []);

  const handleCloseDetail = () => {
    setDetailOpen(false);
    setSelectedItem(null);
  };

  const clearSelection = useCallback(() => {
    setSelected(new Set());
  }, []);

  const selectAll = useCallback(() => {
    setSelected(new Set(data.map((d) => d.id)));
  }, [data]);

  const resetDirectoryView = useCallback(() => {
    setData([]);
    setDirectories([]);
    setHasMore(false);
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

      if (pageRes.code === 0 && pageRes.data) {
        const list = pageRes.data.list || [];
        setData(list);
        setTotal(pageRes.data.pagination?.total || 0);
        setHasMore(list.length < (pageRes.data.pagination?.total || 0));
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
        setDirectories(children);
      }
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
    if (refreshTrigger > 0) {
      loadDirectoryData();
    }
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

  const triggerDelete = (ids, label) => setDeleteDialog({ open: true, ids, label });
  const closeDeleteDialog = () => {
    if (!deleting) setDeleteDialog({ open: false, ids: [], label: '' });
  };

  const confirmDelete = async () => {
    if (!deleteDialog.ids.length) return;
    setDeleting(true);
    try {
      if (deleteDialog.ids.length === 1) {
        await FileDocs.delete(deleteDialog.ids[0]);
      } else {
        await FileDocs.batch({ action: 'delete', ids: deleteDialog.ids });
      }
      setDeleteDialog({ open: false, ids: [], label: '' });
      refreshAfterMutation();
    } catch (e) {
      console.error(e);
    } finally {
      setDeleting(false);
    }
  };

  const breadcrumbs = currentDir ? currentDir.split('/').filter(Boolean) : [];

  const navigateToDir = (path) => {
    setCurrentDir(path || null);
    setPathEditing(false);
  };

  const startPathEdit = () => {
    setPathInput(currentDir || '/');
    setPathEditing(true);
    setTimeout(() => pathInputRef.current?.focus(), 0);
  };

  const commitPathEdit = () => {
    const raw = pathInput.trim();
    const normalized = raw === '/' || raw === '' ? null : (raw.startsWith('/') ? raw : `/${raw}`);
    navigateToDir(normalized);
  };

  const cancelPathEdit = () => setPathEditing(false);

  const handleViewModeChange = (_, val) => {
    if (!val) return;
    setViewMode(val);
  };


  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, height: '100%' }}>
      <FilesAdminToolbar
        currentDir={currentDir}
        breadcrumbs={breadcrumbs}
        pathEditing={pathEditing}
        pathInput={pathInput}
        pathInputRef={pathInputRef}
        loading={loading}
        viewMode={viewMode}
        onPathInputChange={(e) => setPathInput(e.target.value)}
        onCommitPathEdit={commitPathEdit}
        onCancelPathEdit={cancelPathEdit}
        onStartPathEdit={startPathEdit}
        onNavigateToDir={navigateToDir}
        onViewModeChange={handleViewModeChange}
        onRefresh={handleRefresh}
      />

      <FilesAdminSelectionBar
        selectedCount={selected.size}
        onOpenMigrate={() => setMigrateDialog({ open: true, ids: [...selected] })}
        onDeleteSelected={() => triggerDelete([...selected], `${selected.size} 个文件`)}
        onClearSelection={clearSelection}
      />

      {error && <Alert severity="error" sx={{ flexShrink: 0 }}>{error}</Alert>}


      <FilesAdminContent
        loading={loading}
        data={data}
        directories={directories}
        hasMore={hasMore}
        total={total}
        cols={cols}
        viewMode={viewMode}
        selected={selected}
        onToggleSelect={toggleSelect}
        onSelectAll={selectAll}
        onClearSelection={clearSelection}
        onNavigateToDir={navigateToDir}
        onOpenDetail={handleOpenDetail}
        onTriggerDelete={triggerDelete}
        sentinelRef={sentinelRef}
      />

      <ConfirmDialog
        open={deleteDialog.open}
        title="确认删除"
        onClose={closeDeleteDialog}
        onConfirm={confirmDelete}
        confirmLoading={deleting}
        confirmText="确认删除"
      >
        确定要彻底删除 <b>{deleteDialog.label}</b> 吗？<br />
        此操作将同时从数据库和云存储中永久移除，且不可恢复。
      </ConfirmDialog>

      <ImageDetailLightbox
        open={detailOpen}
        item={selectedItem}
        onClose={handleCloseDetail}
        onDelete={triggerDelete}
      />

      <FilesAdminMigrateDialog
        open={migrateDialog.open}
        ids={migrateDialog.ids}
        onClose={() => setMigrateDialog({ open: false, ids: [] })}
        onSuccess={refreshAfterMutation}
      />
    </Box>
  );
}
