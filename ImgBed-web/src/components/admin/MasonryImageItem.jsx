import { memo, useState, useEffect } from 'react';
import { Box, Checkbox, Typography, IconButton, useTheme } from '@mui/material';
import DeleteIcon from '@mui/icons-material/Delete';
import { BORDER_RADIUS } from '../../utils/constants';
import { fmtDate } from '../../utils/formatters';
import imageCacheManager from '../../utils/imageCache';

const getImageSrc = (item) => `/${item.id}`;

/**
 * 瀑布流图片展示核心 - 仅在 id 改变时重渲染
 */
const MasonryImage = memo(({ item, onOpenDetail, hasSelection }) => {
  useEffect(() => {
    // 图片加载成功后标记为已缓存
    imageCacheManager.markAsLoaded(item.id);
  }, [item.id]);

  return (
    <Box
      component="img"
      src={getImageSrc(item)}
      onClick={() => !hasSelection && onOpenDetail?.(null, item)}
      loading="lazy"
      sx={{
        display: 'block',
        width: '100%',
        aspectRatio: item.width && item.height ? `${item.width}/${item.height}` : 'auto',
        minHeight: item.width && item.height ? 'auto' : '200px',
        height: 'auto',
        borderRadius: BORDER_RADIUS.md,
        cursor: hasSelection ? 'pointer' : 'pointer',
        transition: 'transform 0.3s cubic-bezier(0.4, 0, 0.2, 1), opacity 0.2s',
        bgcolor: 'action.hover'
      }}
    />
  );
}, (prev, next) => prev.item.id === next.item.id && prev.hasSelection === next.hasSelection);
MasonryImage.displayName = 'MasonryImage';

/**
 * 瀑布流项容器 - 初始仅保留必要结构，悬浮后再挂载信息与操作层
 */
const MasonryImageItem = memo(({
  item,
  isSelected,
  toggleSelect,
  triggerDelete,
  onOpenDetail,
  hasSelection,
}) => {
  const theme = useTheme();
  const [hovered, setHovered] = useState(false);
  const deleteHoverColor = theme.palette.error.main;
  const showOverlay = hovered || isSelected;

  // 点击图片区域的处理逻辑
  const handleImageClick = () => {
    if (hasSelection) {
      // 如果有选中项，点击图片任意位置都是切换选中状态
      toggleSelect(item.id);
    } else {
      // 如果没有选中项，点击图片打开详情
      onOpenDetail?.(null, item);
    }
  };

  return (
    <Box
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      sx={{
        position: 'relative',
        borderRadius: BORDER_RADIUS.md,
        overflow: 'hidden',
        lineHeight: 0,
        transition: 'box-shadow 0.2s',
        '&:hover img': {
          transform: 'scale(1.02)',
          opacity: 0.95
        }
      }}
    >
      {/* 选中状态描边层 */}
      {isSelected && (
        <Box
          sx={{
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            border: `2px solid ${theme.palette.mode === 'dark' ? theme.palette.primary.light : theme.palette.primary.main}`,
            borderRadius: BORDER_RADIUS.md,
            pointerEvents: 'none',
            zIndex: 1
          }}
        />
      )}

      <Box onClick={handleImageClick} sx={{ cursor: 'pointer' }}>
        <MasonryImage item={item} onOpenDetail={onOpenDetail} hasSelection={hasSelection} />
      </Box>

      <Box
        sx={{
          position: 'absolute', top: 8, left: 8,
          opacity: showOverlay ? 1 : 0, transition: 'opacity 0.2s',
          zIndex: 2
        }}
        onClick={(e) => {
          e.stopPropagation();
          toggleSelect(item.id);
        }}
      >
        <Checkbox
          size="small"
          checked={isSelected}
          onChange={() => {}}
          disableRipple
          sx={{
            bgcolor: theme.palette.mode === 'dark' ? 'rgba(0,0,0,0.7)' : 'rgba(255,255,255,0.9)',
            borderRadius: BORDER_RADIUS.sm,
            p: 0.5,
            '&.Mui-checked': {
              bgcolor: theme.palette.mode === 'dark' ? 'rgba(0,0,0,0.85)' : 'white'
            },
            '&:hover': {
              bgcolor: theme.palette.mode === 'dark' ? 'rgba(0,0,0,0.85)' : 'white'
            },
            '&:focus': {
              outline: 'none'
            },
            '& .MuiTouchRipple-root': {
              display: 'none'
            }
          }}
        />
      </Box>

      {showOverlay && (
        <Box
          onClick={handleImageClick}
          sx={{
            position: 'absolute', bottom: 0, left: 0, right: 0,
            background: 'linear-gradient(to top, rgba(0,0,0,0.7) 0%, rgba(0,0,0,0) 100%)',
            color: 'white', px: 1.5, pt: 3, pb: 1,
            display: 'flex', alignItems: 'flex-end',
            cursor: 'pointer'
          }}
        >
          <Box sx={{ flex: 1, overflow: 'hidden', mb: 0.5 }}>
            <Typography variant="caption" noWrap sx={{ display: 'block', fontWeight: 'bold', textShadow: '0 1px 2px rgba(0,0,0,0.5)' }}>
              {item.original_name || item.file_name}
            </Typography>
            <Typography variant="caption" sx={{ opacity: 0.8, fontSize: '0.7rem' }}>
              {fmtDate(item.created_at)}
            </Typography>
          </Box>
          <IconButton
            size="small"
            title="删除"
            sx={{ color: 'white', '&:hover': { color: deleteHoverColor, bgcolor: 'rgba(255,255,255,0.1)' } }}
            onClick={(e) => {
              e.stopPropagation();
              triggerDelete(e.currentTarget, [item.id], item.original_name || item.file_name);
            }}
          >
            <DeleteIcon fontSize="small" />
          </IconButton>
        </Box>
      )}
    </Box>
  );
}, (prev, next) => prev.item.id === next.item.id && prev.isSelected === next.isSelected && prev.hasSelection === next.hasSelection);
MasonryImageItem.displayName = 'MasonryImageItem';

export { MasonryImageItem as default };
