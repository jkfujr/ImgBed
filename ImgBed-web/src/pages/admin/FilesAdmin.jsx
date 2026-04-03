import { useState, useRef } from 'react';
import { Box, Alert, useTheme, useMediaQuery } from '@mui/material';
import FilesAdminToolbar from '../../components/admin/FilesAdminToolbar';
import FilesAdminSelectionBar from '../../components/admin/FilesAdminSelectionBar';
import FilesAdminContent from '../../components/admin/FilesAdminContent';
import FilesAdminMigrateDialog from '../../components/admin/FilesAdminMigrateDialog';
import ImageDetailLightbox from '../../components/admin/ImageDetailLightbox';
import ConfirmDialog from '../../components/common/ConfirmDialog';
import { useUserPreference } from '../../hooks/useUserPreference';
import { useFilesAdmin } from '../../hooks/useFilesAdmin';

export default function FilesAdmin() {
  const theme = useTheme();
  const isXl = useMediaQuery(theme.breakpoints.up('xl'));
  const isLg = useMediaQuery(theme.breakpoints.up('lg'));
  const isMd = useMediaQuery(theme.breakpoints.up('md'));
  const [prefCols] = useUserPreference('pref_masonry_cols', '0');
  const autoCols = isXl ? 5 : isLg ? 4 : isMd ? 3 : 2;
  const cols = parseInt(prefCols, 10) > 0 ? parseInt(prefCols, 10) : autoCols;

  const [viewMode, setViewMode] = useUserPreference('pref_view_mode', 'masonry');
  const [pathEditing, setPathEditing] = useState(false);
  const [pathInput, setPathInput] = useState('');
  const pathInputRef = useRef(null);
  const sentinelRef = useRef(null);

  const {
    data, total, loading, hasMore, directories, currentDir, selected, error,
    deleteDialog, deleting, migrateDialog, detailOpen, selectedItem,
    handleOpenDetail, handleCloseDetail,
    clearSelection, selectAll,
    handleRefresh, refreshAfterMutation,
    toggleSelect,
    triggerDelete, closeDeleteDialog, confirmDelete,
    navigateToDir: rawNavigateToDir,
    openMigrate, closeMigrate,
  } = useFilesAdmin();

  const navigateToDir = (path) => {
    rawNavigateToDir(path);
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

  const breadcrumbs = currentDir ? currentDir.split('/').filter(Boolean) : [];

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
        onOpenMigrate={openMigrate}
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
        onClose={closeMigrate}
        onSuccess={refreshAfterMutation}
      />
    </Box>
  );
}
