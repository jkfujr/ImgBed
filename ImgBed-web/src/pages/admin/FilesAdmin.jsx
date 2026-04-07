import { useMemo } from 'react';
import { Box, Alert, useTheme, useMediaQuery } from '@mui/material';
import FilesAdminToolbar from '../../components/admin/FilesAdminToolbar';
import FilesAdminSelectionBar from '../../components/admin/FilesAdminSelectionBar';
import FilesAdminContent from '../../components/admin/FilesAdminContent';
import FilesAdminMigrateDialog from '../../components/admin/FilesAdminMigrateDialog';
import FilesAdminMoveDialog from '../../components/admin/FilesAdminMoveDialog';
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
  const [viewMode, setViewMode] = useUserPreference('pref_view_mode', 'masonry');

  let autoCols = 2;
  if (isXl) {
    autoCols = 5;
  } else if (isLg) {
    autoCols = 4;
  } else if (isMd) {
    autoCols = 3;
  }
  const cols = parseInt(prefCols, 10) > 0 ? parseInt(prefCols, 10) : autoCols;

  const {
    data, total, loading, hasMore, directories, currentDir, selected, error,
    deleteDialog, deleting, migrateDialog, moveDialog, detailOpen, selectedItem,
    handleOpenDetail, handleCloseDetail,
    clearSelection, selectAll,
    handleRefresh, refreshAfterMutation,
    toggleSelect,
    triggerDelete, closeDeleteDialog, confirmDelete,
    navigateToDir,
    openMigrate, closeMigrate,
    openMove, closeMove,
  } = useFilesAdmin();

  const handleViewModeChange = (_, val) => {
    if (!val) return;
    setViewMode(val);
  };

  const breadcrumbs = useMemo(
    () => (currentDir ? currentDir.split('/').filter(Boolean) : []),
    [currentDir]
  );

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, height: '100%' }}>
      <FilesAdminToolbar
        currentDir={currentDir}
        breadcrumbs={breadcrumbs}
        loading={loading}
        viewMode={viewMode}
        onNavigateToDir={navigateToDir}
        onViewModeChange={handleViewModeChange}
        onRefresh={handleRefresh}
      />

      <FilesAdminSelectionBar
        selectedCount={selected.size}
        onOpenMove={openMove}
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

      <FilesAdminMoveDialog
        open={moveDialog.open}
        ids={moveDialog.ids}
        currentDir={currentDir}
        onClose={closeMove}
        onSuccess={refreshAfterMutation}
      />
    </Box>
  );
}
