import { useEffect, useRef } from 'react';
import { Box, CircularProgress, Typography, Alert, Button } from '@mui/material';
import FilesAdminMasonryView from './FilesAdminMasonryView';
import FilesAdminListView from './FilesAdminListView';
import LoadingSpinner from '../common/LoadingSpinner';

export default function FilesAdminContent({
  loading,
  masonryData,
  pageData,
  directories,
  hasMore,
  total,
  totalPages,
  currentPage,
  cols,
  viewMode,
  selected,
  searchQuery,
  onToggleSelect,
  onSelectAll,
  onClearSelection,
  onNavigateToDir,
  onOpenDetail,
  onTriggerDelete,
  onLoadNextPage,
  onPageChange,
  onClearSearch,
}) {
  const hasItems = masonryData.length > 0 || pageData.length > 0 || directories.length > 0;
  const showDirectories = !searchQuery && directories.length > 0;
  const scrollContainerRef = useRef(null);
  const sentinelRef = useRef(null);

  // 包装 triggerDelete，注入当前页的完整 item 供 TG 24h 判断
  const handleTriggerDelete = (trigger, ids, label) => {
    const sourceData = viewMode === 'masonry' ? masonryData : pageData;
    const items = sourceData.filter((item) => ids.includes(item.id));
    onTriggerDelete(trigger, ids, label, items);
  };

  useEffect(() => {
    if (viewMode !== 'masonry') return undefined;

    const node = sentinelRef.current;
    const root = scrollContainerRef.current;
    if (!node || !root || !hasMore || loading) return undefined;

    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) {
        onLoadNextPage?.();
      }
    }, {
      root,
      rootMargin: '200px 0px',
      threshold: 0,
    });

    observer.observe(node);
    return () => observer.disconnect();
  }, [hasMore, loading, onLoadNextPage, viewMode]);

  return (
    <Box
      ref={scrollContainerRef}
      sx={{ flexGrow: 1, minHeight: 0, height: '100%', overflow: viewMode === 'list' ? 'hidden' : 'auto' }}
    >
      {searchQuery && (
        <Alert
          severity="info"
          sx={{ m: 2 }}
          action={
            <Button color="inherit" size="small" onClick={onClearSearch}>
              清除搜索
            </Button>
          }
        >
          搜索结果："{searchQuery}" （共 {total} 个文件）
        </Alert>
      )}

      {loading && masonryData.length === 0 && pageData.length === 0 && <LoadingSpinner />}

      {!loading && masonryData.length === 0 && pageData.length === 0 && directories.length === 0 && (
        <Box sx={{ textAlign: 'center', py: 6, color: 'text.secondary' }}>
          <Typography>{searchQuery ? '未找到匹配的文件' : '暂无文件'}</Typography>
        </Box>
      )}

      {hasItems && viewMode === 'masonry' && (
        <FilesAdminMasonryView
          directories={showDirectories ? directories : []}
          data={masonryData}
          cols={cols}
          selected={selected}
          onNavigateToDir={onNavigateToDir}
          onToggleSelect={onToggleSelect}
          onTriggerDelete={handleTriggerDelete}
          onOpenDetail={onOpenDetail}
        />
      )}

      {hasItems && viewMode === 'list' && (
        <FilesAdminListView
          directories={showDirectories ? directories : []}
          data={pageData}
          total={total}
          totalPages={totalPages}
          currentPage={currentPage}
          loading={loading}
          selected={selected}
          onToggleSelect={onToggleSelect}
          onSelectAll={onSelectAll}
          onClearSelection={onClearSelection}
          onNavigateToDir={onNavigateToDir}
          onOpenDetail={onOpenDetail}
          onTriggerDelete={handleTriggerDelete}
          onPageChange={onPageChange}
        />
      )}

      {viewMode === 'masonry' && (
        <Box ref={sentinelRef} sx={{ py: 1, display: 'flex', justifyContent: 'center' }}>
          {loading && masonryData.length > 0 && <CircularProgress size={24} />}
          {!loading && hasMore && (
            <Typography variant="caption" color="text.secondary">
              已加载 {masonryData.length} / {total} 张图片，继续下拉以加载更多
            </Typography>
          )}
          {!loading && !hasMore && masonryData.length > 0 && (
            <Typography variant="caption" color="text.secondary">共 {total} 张图片，已全部加载</Typography>
          )}
        </Box>
      )}
    </Box>
  );
}
