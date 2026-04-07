import { useEffect, useMemo, useRef, useState } from 'react';
import { Box, CircularProgress, Typography } from '@mui/material';
import FilesAdminMasonryView from './FilesAdminMasonryView';
import FilesAdminListView from './FilesAdminListView';
import LoadingSpinner from '../common/LoadingSpinner';

const INITIAL_RENDER_COUNT = {
  masonry: 24,
  list: 40,
};

const RENDER_STEP = {
  masonry: 24,
  list: 40,
};

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
}) {
  const hasItems = data.length > 0 || directories.length > 0;
  const initialRenderCount = INITIAL_RENDER_COUNT[viewMode] || INITIAL_RENDER_COUNT.masonry;
  const renderStep = RENDER_STEP[viewMode] || RENDER_STEP.masonry;
  const sentinelRef = useRef(null);

  // 使用 useMemo 计算初始可见数量，当 data 或 directories 变化时重置
  const initialVisible = useMemo(() => initialRenderCount, [initialRenderCount, data, directories]); // eslint-disable-line react-hooks/exhaustive-deps
  const [visibleCount, setVisibleCount] = useState(initialVisible);

  const visibleData = useMemo(
    () => data.slice(0, visibleCount),
    [data, visibleCount]
  );
  const hasMoreVisible = visibleCount < data.length;

  useEffect(() => {
    const node = sentinelRef.current;
    if (!node || !hasMoreVisible) return undefined;

    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) {
        setVisibleCount((prev) => Math.min(prev + renderStep, data.length));
      }
    }, {
      root: null,
      rootMargin: '200px 0px',
      threshold: 0,
    });

    observer.observe(node);
    return () => observer.disconnect();
  }, [data.length, hasMoreVisible, renderStep]);

  return (
    <Box sx={{ flexGrow: 1, overflow: 'auto', overflowX: 'hidden', minHeight: 0 }}>
      {loading && data.length === 0 && <LoadingSpinner />}

      {!loading && data.length === 0 && directories.length === 0 && (
        <Box sx={{ textAlign: 'center', py: 6, color: 'text.secondary' }}>
          <Typography>暂无文件</Typography>
        </Box>
      )}

      {hasItems && viewMode === 'masonry' && (
        <FilesAdminMasonryView
          directories={directories}
          data={visibleData}
          cols={cols}
          selected={selected}
          onNavigateToDir={onNavigateToDir}
          onToggleSelect={onToggleSelect}
          onTriggerDelete={onTriggerDelete}
          onOpenDetail={onOpenDetail}
        />
      )}

      {hasItems && viewMode === 'list' && (
        <FilesAdminListView
          directories={directories}
          data={visibleData}
          selected={selected}
          onToggleSelect={onToggleSelect}
          onSelectAll={onSelectAll}
          onClearSelection={onClearSelection}
          onNavigateToDir={onNavigateToDir}
          onOpenDetail={onOpenDetail}
          onTriggerDelete={onTriggerDelete}
        />
      )}

      <Box ref={sentinelRef} sx={{ py: 1, display: 'flex', justifyContent: 'center' }}>
        {loading && data.length > 0 && <CircularProgress size={24} />}
        {!loading && hasMoreVisible && (
          <Typography variant="caption" color="text.secondary">
            已渲染 {visibleData.length} / {data.length} 个文件，继续滚动以加载更多
          </Typography>
        )}
        {!hasMoreVisible && !hasMore && data.length > 0 && (
          <Typography variant="caption" color="text.secondary">共 {total} 个文件，已全部加载</Typography>
        )}
      </Box>
    </Box>
  );
}
