import React, { memo } from 'react';
import { Box, Checkbox, Typography, IconButton, Tooltip } from '@mui/material';
import DeleteIcon from '@mui/icons-material/Delete';
import { BORDER_RADIUS } from '../../utils/constants';

/**
 * 纯图片展示组件 - 独立 memo，只有 id 改变才重渲染
 * 鼠标移动悬浮不会触发这个组件重渲染，图片永远稳定
 */
const MasonryImage = memo(({ item, onOpenDetail }) => (
    <Box
      component="img"
      src={`/${item.id}`}
      onClick={() => onOpenDetail?.(item)}
      sx={{
        display: 'block',
        width: '100%',
        height: 'auto', // 真正的瀑布流：宽度固定，高度自适应
        borderRadius: BORDER_RADIUS.md,
        cursor: 'pointer',
        transition: 'opacity 0.2s, transform 0.2s',
        bgcolor: 'action.hover',
        '&:hover': {
          opacity: 0.9,
          transform: 'scale(1.01)'
        }
      }}
    />
), (prev, next) => prev.item.id === next.item.id);
MasonryImage.displayName = 'MasonryImage';

/**
 * 瀑布流图片项组件
 * 使用 CSS :hover 处理悬浮效果，完全不需要 React 状态
 * 这样鼠标移动根本不会触发任何重渲染
 */
const MasonryImageItem = memo(({
  item,
  isSelected,
  toggleSelect,
  triggerDelete,
  onOpenDetail,
}) => (
  <Box
    sx={{
      position: 'relative',
      borderRadius: BORDER_RADIUS.md,
      overflow: 'hidden',
      lineHeight: 0, // 消除 img 下方的微小间隙
      '&:hover .overlay-controls': { opacity: 1 },
    }}
  >
    <MasonryImage item={item} onOpenDetail={onOpenDetail} />
    {/* 左上角复选框 - 选中总是显示，hover 显示，CSS 过渡，不需要 React 状态 */}
    <Box className="overlay-controls" component="div" sx={{
      position: 'absolute',
      top: 4,
      left: 4,
      opacity: isSelected ? 1 : 0,
      transition: 'opacity 0.15s',
      '&:hover': { opacity: 1 },
    }}>
      <Checkbox size="small" checked={isSelected}
        onChange={() => toggleSelect(item.id)}
        sx={{ bgcolor: 'rgba(255,255,255,0.85)', borderRadius: BORDER_RADIUS.sm, p: 0.3,
          '&:hover': { bgcolor: 'white' } }} />
    </Box>
    {/* 底部信息条 - 同样 CSS :hover 控制 */}
    <Box className="overlay-controls" component="div" sx={{
      position: 'absolute',
      bottom: 0,
      left: 0,
      right: 0,
      bgcolor: 'rgba(0,0,0,0.55)',
      color: 'white',
      px: 1,
      py: 0.5,
      display: 'flex',
      alignItems: 'center',
      opacity: isSelected ? 1 : 0,
      transition: 'opacity 0.15s',
      '&:hover': { opacity: 1 },
    }}>
      <Box sx={{ flex: 1, overflow: 'hidden' }}>
        <Typography variant="caption" noWrap sx={{ display: 'block' }}>
          {item.original_name || item.file_name}
        </Typography>
        <Typography variant="caption" sx={{ opacity: 0.75 }}>
          {fmtDate(item.created_at)}
        </Typography>
      </Box>
      <Tooltip title="删除">
        <IconButton size="small" sx={{ color: 'white', '&:hover': { color: '#ff6b6b' } }}
          onClick={() => triggerDelete([item.id], item.original_name || item.file_name)}>
          <DeleteIcon fontSize="small" />
        </IconButton>
      </Tooltip>
    </Box>
  </Box>
), (prev, next) => {
  // 只有 id 和选中状态改变才重渲染
  // 完全不需要 hover 状态！CSS 自己处理悬浮
  return prev.item.id === next.item.id &&
         prev.isSelected === next.isSelected;
});
MasonryImageItem.displayName = 'MasonryImageItem';

export default MasonryImageItem;

// 需要导入 fmtDate，这里避免循环依赖，在使用处导入传入
// 由于 memo 比较函数只关注 id 和 selected，fmtDate 改变不影响
import { fmtDate } from '../../utils/formatters';
