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

  const escapeHtml = (str) => {
    if (!str) return '';
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;');
  };

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
    masonryData, pageData, total, totalPages, currentPage, loading, hasMore, directories, currentDir, searchQuery, selected, error,
    deleteDialog, deleting, migrateDialog, moveDialog, detailOpen, selectedItem,
    handleOpenDetail, handleCloseDetail, triggerDeleteFromDetail,
    clearSelection, selectAll,
    handleRefresh, refreshAfterMutation,
    toggleSelect,
    triggerDelete, closeDeleteDialog, confirmDelete,
    navigateToDir,
    openMigrate, closeMigrate,
    openMove, closeMove,
    loadNextPage, goToPage, clearSearch,
  } = useFilesAdmin(viewMode);

  const currentFiles = viewMode === 'masonry' ? masonryData : pageData;

  const handleViewModeChange = (_, val) => {
    if (!val) return;
    clearSelection();
    setViewMode(val);
  };

  // 批量删除时，收集选中项的完整对象供 TG 24h 判断
  const handleDeleteSelected = (trigger) => {
    if (deleteDialog.open || selected.size === 0) return;
    const selectedItems = currentFiles.filter((item) => selected.has(item.id));
    triggerDelete(trigger, [...selected], `${selected.size} 个文件`, selectedItems);
  };

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, height: '100%' }}>
      <FilesAdminToolbar
        currentDir={currentDir}
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
        onDeleteSelected={handleDeleteSelected}
        onClearSelection={clearSelection}
      />

      {error && <Alert severity="error" sx={{ flexShrink: 0 }}>{error}</Alert>}

      <FilesAdminContent
        loading={loading}
        masonryData={masonryData}
        pageData={pageData}
        directories={directories}
        hasMore={hasMore}
        total={total}
        totalPages={totalPages}
        currentPage={currentPage}
        cols={cols}
        viewMode={viewMode}
        selected={selected}
        searchQuery={searchQuery}
        onToggleSelect={toggleSelect}
        onSelectAll={selectAll}
        onClearSelection={clearSelection}
        onNavigateToDir={navigateToDir}
        onOpenDetail={handleOpenDetail}
        onTriggerDelete={triggerDelete}
        onLoadNextPage={loadNextPage}
        onPageChange={goToPage}
        onClearSearch={clearSearch}
      />

      <ConfirmDialog
        open={deleteDialog.open}
        title="确认删除"
        onClose={closeDeleteDialog}
        onConfirm={confirmDelete}
        confirmLoading={deleting}
        confirmText={deleteDialog.errorMessage ? '关闭' : '确认删除'}
        confirmDisabled={!!deleteDialog.errorMessage}
      >
        {deleteDialog.errorMessage ? (
          <Alert severity="error">{deleteDialog.errorMessage}</Alert>
        ) : deleteDialog.deleteMode === 'index_only' ? (
          <>
            确定要从索引中移除 <b>{escapeHtml(deleteDialog.label)}</b> 吗？<br />
            该文件存储在 Telegram 服务器且上传已超过 24 小时，无法从 Telegram 端删除，仅移除索引记录，文件仍可通过直链访问。
          </>
        ) : (
          <>
            确定要彻底删除 <b>{escapeHtml(deleteDialog.label)}</b> 吗？<br />
            此操作将同时从数据库和云存储中永久移除，且不可恢复。
          </>
        )}
      </ConfirmDialog>

      <ImageDetailLightbox
        open={detailOpen}
        item={selectedItem}
        onClose={handleCloseDetail}
        onDelete={triggerDeleteFromDetail}
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
