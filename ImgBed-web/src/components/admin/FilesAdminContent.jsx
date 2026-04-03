import { Box, CircularProgress, Typography } from '@mui/material';
import FilesAdminMasonryView from './FilesAdminMasonryView';
import FilesAdminListView from './FilesAdminListView';

export default function FilesAdminContent({
  loading,
  data,
  directories,
  hasMore,
  total,
  cols,
  viewMode,
  selected,
  onToggleSelect,
  onSelectAll,
  onClearSelection,
  onNavigateToDir,
  onOpenDetail,
  onTriggerDelete,
  sentinelRef,
}) {
  const hasItems = data.length > 0 || directories.length > 0;

  return (
    <Box sx={{ flexGrow: 1, overflow: 'auto', overflowX: 'hidden', minHeight: 0 }}>
      {loading && data.length === 0 && (
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}>
          <CircularProgress />
        </Box>
      )}

      {!loading && data.length === 0 && directories.length === 0 && (
        <Box sx={{ textAlign: 'center', py: 6, color: 'text.secondary' }}>
          <Typography>暂无文件</Typography>
        </Box>
      )}

      {hasItems && (
        <>
          <Box sx={{ display: viewMode === 'masonry' ? 'block' : 'none' }}>
            <FilesAdminMasonryView
              directories={directories}
              data={data}
              cols={cols}
              selected={selected}
              onNavigateToDir={onNavigateToDir}
              onToggleSelect={onToggleSelect}
              onTriggerDelete={onTriggerDelete}
              onOpenDetail={onOpenDetail}
            />
          </Box>

          <Box sx={{ display: viewMode === 'list' ? 'block' : 'none' }}>
            <FilesAdminListView
              directories={directories}
              data={data}
              selected={selected}
              onToggleSelect={onToggleSelect}
              onSelectAll={onSelectAll}
              onClearSelection={onClearSelection}
              onNavigateToDir={onNavigateToDir}
              onOpenDetail={onOpenDetail}
              onTriggerDelete={onTriggerDelete}
            />
          </Box>
        </>
      )}

      <Box ref={sentinelRef} sx={{ py: 1, display: 'flex', justifyContent: 'center' }}>
        {loading && data.length > 0 && <CircularProgress size={24} />}
        {!hasMore && data.length > 0 && (
          <Typography variant="caption" color="text.secondary">共 {total} 个文件，已全部加载</Typography>
        )}
      </Box>
    </Box>
  );
}
