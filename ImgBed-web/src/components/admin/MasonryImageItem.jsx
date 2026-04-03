import { memo } from 'react';
import { Box, Checkbox, Typography, IconButton, Tooltip } from '@mui/material';
import DeleteIcon from '@mui/icons-material/Delete';
import { BORDER_RADIUS } from '../../utils/constants';

/**
 * 瀑布流图片展示核心 - 仅在 id 改变时重渲染
 */
const MasonryImage = memo(({ item, onOpenDetail }) => (
  <Box
    component="img"
    src={`/${item.id}`}
    onClick={() => onOpenDetail?.(item)}
    loading="lazy"
    sx={{
      display: 'block',
      width: '100%',
      aspectRatio: item.width && item.height ? `${item.width}/${item.height}` : 'auto',
      minHeight: item.width && item.height ? 'auto' : '200px',
      height: 'auto',
      borderRadius: BORDER_RADIUS.md,
      cursor: 'pointer',
      transition: 'transform 0.3s cubic-bezier(0.4, 0, 0.2, 1), opacity 0.2s',
      bgcolor: 'action.hover'
    }}
  />
), (prev, next) => prev.item.id === next.item.id);
MasonryImage.displayName = 'MasonryImage';

/**
 * 瀑布流项容器 - 采用全 CSS 悬浮逻辑，避免 React 状态触发重渲染
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
      lineHeight: 0,
      boxShadow: isSelected ? `0 0 0 3px ${'#1976d2'}80` : 'none',
      transition: 'box-shadow 0.2s',
      '&:hover .overlay-controls': { opacity: 1 },
      // 关键修复：防止 hover 缩放溢出容器
      '&:hover img': {
        transform: 'scale(1.02)',
        opacity: 0.95
      }
    }}
  >
    <MasonryImage item={item} onOpenDetail={onOpenDetail} />

    {/* 选框控制层 */}
    <Box className="overlay-controls" sx={{
      position: 'absolute', top: 8, left: 8,
      opacity: isSelected ? 1 : 0, transition: 'opacity 0.2s',
      zIndex: 2
    }}>
      <Checkbox
        size="small"
        checked={isSelected}
        onChange={() => toggleSelect(item.id)}
        sx={{
          bgcolor: 'rgba(255,255,255,0.9)',
          borderRadius: BORDER_RADIUS.sm,
          p: 0.5,
          '&.Mui-checked': { bgcolor: 'white' },
          '&:hover': { bgcolor: 'white' }
        }}
      />
    </Box>

    {/* 底部信息与操作条 */}
    <Box className="overlay-controls" sx={{
      position: 'absolute', bottom: 0, left: 0, right: 0,
      background: 'linear-gradient(to top, rgba(0,0,0,0.7) 0%, rgba(0,0,0,0) 100%)',
      color: 'white', px: 1.5, pt: 3, pb: 1,
      display: 'flex', alignItems: 'flex-end',
      opacity: 0,
      transition: 'opacity 0.2s',
      pointerEvents: 'none',
      '& > *': { pointerEvents: 'auto' }
    }}>
      <Box sx={{ flex: 1, overflow: 'hidden', mb: 0.5 }}>
        <Typography variant="caption" noWrap sx={{ display: 'block', fontWeight: 'bold', textShadow: '0 1px 2px rgba(0,0,0,0.5)' }}>
          {item.original_name || item.file_name}
        </Typography>
        <Typography variant="caption" sx={{ opacity: 0.8, fontSize: '0.7rem' }}>
          {fmtDate(item.created_at)}
        </Typography>
      </Box>
      <Tooltip title="删除">
        <IconButton
          size="small"
          sx={{ color: 'white', '&:hover': { color: '#ff5252', bgcolor: 'rgba(255,255,255,0.1)' } }}
          onClick={() => triggerDelete([item.id], item.original_name || item.file_name)}
        >
          <DeleteIcon fontSize="small" />
        </IconButton>
      </Tooltip>
    </Box>
  </Box>
), (prev, next) => prev.item.id === next.item.id && prev.isSelected === next.isSelected);
MasonryImageItem.displayName = 'MasonryImageItem';

export default MasonryImageItem;

// 需要导入 fmtDate，这里避免循环依赖，在使用处导入传入
// 由于 memo 比较函数只关注 id 和 selected，fmtDate 改变不影响
import { fmtDate } from '../../utils/formatters';
