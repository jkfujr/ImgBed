import React, { useState, useCallback, useEffect } from 'react';
import {
  Box, Typography, IconButton, Paper, Divider, Chip, Button, Dialog, useTheme, useMediaQuery
} from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import DeleteIcon from '@mui/icons-material/Delete';
import ImageIcon from '@mui/icons-material/Image';
import { fmtDate, fmtSize, parseChannelName, channelTypeLabel, parseTags } from '../../utils/formatters';
import { BORDER_RADIUS } from '../../utils/constants';

const ImageDetailLightbox = ({
  open,
  item,
  onClose,
  onDelete
}) => {
  const theme = useTheme();
  const isLg = useMediaQuery(theme.breakpoints.up('lg'));

  const [imgTransform, setImgTransform] = useState({ x: 0, y: 0, scale: 1 });
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });

  // 当切换图片或打开时重置状态
  useEffect(() => {
    if (open) {
      setImgTransform({ x: 0, y: 0, scale: 1 });
    }
  }, [open, item?.id]);

  const containerRef = React.useRef(null);

  const handleWheel = useCallback((e) => {
    e.preventDefault();
    const delta = e.deltaY > 0 ? 0.9 : 1.1;
    setImgTransform(prev => ({
      ...prev,
      scale: Math.min(Math.max(prev.scale * delta, 0.2), 15)
    }));
  }, []);

  useEffect(() => {
    const node = containerRef.current;
    if (node) {
      node.addEventListener('wheel', handleWheel, { passive: false });
      return () => node.removeEventListener('wheel', handleWheel);
    }
  }, [handleWheel]);

  const handleMouseDown = (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    setIsDragging(true);
    setDragStart({ x: e.clientX - imgTransform.x, y: e.clientY - imgTransform.y });
  };

  const handleMouseMove = useCallback((e) => {
    if (!isDragging) return;
    setImgTransform(prev => ({
      ...prev,
      x: e.clientX - dragStart.x,
      y: e.clientY - dragStart.y
    }));
  }, [isDragging, dragStart]);

  const handleMouseUp = useCallback(() => {
    setIsDragging(false);
  }, []);

  useEffect(() => {
    if (isDragging) {
      window.addEventListener('mousemove', handleMouseMove);
      window.addEventListener('mouseup', handleMouseUp);
    } else {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    }
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isDragging, handleMouseMove, handleMouseUp]);

  if (!item) return null;

  const infoItems = [
    { label: '文件名', value: item.original_name || item.file_name },
    { label: '文件类型', value: item.mime_type },
    { label: '文件大小', value: fmtSize(item.size) },
    { label: '图片尺寸', value: item.width ? `${item.width} x ${item.height}` : '-' },
    { label: '上传时间', value: fmtDate(item.created_at) },
    { label: '上传用户', value: item.uploader_id || '-' },
    { label: '上传 IP', value: item.upload_ip || '-' },
    { label: '渠道 ID', value: parseChannelName(item.storage_config) },
  ];

  return (
    <Dialog
      fullScreen
      open={open}
      onClose={onClose}
      PaperProps={{
        sx: {
          bgcolor: 'transparent',
          boxShadow: 'none',
          overflow: 'hidden'
        }
      }}
    >
      <Box
        onClick={onClose}
        sx={{
          position: 'absolute',
          inset: 0,
          bgcolor: 'rgba(0,0,0,0.9)',
          zIndex: -1
        }}
      />

      <IconButton
        onClick={onClose}
        sx={{
          position: 'fixed',
          left: 20,
          top: 20,
          zIndex: 100,
          color: 'white',
          bgcolor: 'rgba(255,255,255,0.1)',
          '&:hover': { bgcolor: 'rgba(255,255,255,0.2)' }
        }}
      >
        <CloseIcon />
      </IconButton>

      <Box sx={{ display: 'flex', width: '100%', height: '100%' }}>
        <Box
          ref={containerRef}
          sx={{
            flex: 1,
            position: 'relative',
            overflow: 'hidden',
            display: 'flex',
            justifyContent: 'center',
            alignItems: 'center',
            cursor: isDragging ? 'grabbing' : 'grab',
            userSelect: 'none'
          }}
          onWheel={handleWheel}
          onMouseDown={handleMouseDown}
        >
          <Box
            component="img"
            src={`/${item.id}`}
            alt={item.original_name || item.file_name}
            draggable={false}
            onLoad={(e) => {
              // 可以在这里处理加载完成后的动画或占位图隐藏
              e.target.style.opacity = 1;
            }}
            sx={{
              maxWidth: 'none',
              maxHeight: 'none',
              opacity: 0, // 初始透明，防止闪烁，配合 onLoad
              transform: `translate(${imgTransform.x}px, ${imgTransform.y}px) scale(${imgTransform.scale})`,
              transition: isDragging ? 'none' : 'transform 0.1s ease-out, opacity 0.3s ease-in',
              pointerEvents: 'none',
              filter: 'drop-shadow(0 0 20px rgba(0,0,0,0.5))'
            }}
          />
        </Box>

        {isLg && (
          <Paper
            sx={{
              width: 360,
              height: '100%',
              display: 'flex',
              flexDirection: 'column',
              borderRadius: 0,
              bgcolor: 'background.paper',
              zIndex: 10,
              boxShadow: theme.shadows[10]
            }}
          >
            <Box sx={{ p: 3, borderBottom: '1px solid', borderColor: 'divider' }}>
              <Typography variant="h6" fontWeight="bold" noWrap>
                文件详情
              </Typography>
            </Box>

            <Box sx={{ flex: 1, overflowY: 'auto', p: 3 }}>
              {infoItems.map((info, idx) => (
                <Box key={idx} sx={{ mb: 2.5 }}>
                  <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 0.5, textTransform: 'uppercase', letterSpacing: 1 }}>
                    {info.label}
                  </Typography>
                  <Typography variant="body2" fontWeight="medium" sx={{ wordBreak: 'break-all' }}>
                    {info.value}
                  </Typography>
                </Box>
              ))}

              <Box sx={{ mb: 2.5 }}>
                <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1, textTransform: 'uppercase' }}>
                  渠道类型
                </Typography>
                <Chip
                  label={channelTypeLabel(item.storage_channel)}
                  size="small"
                  color="primary"
                  sx={{ borderRadius: BORDER_RADIUS.sm, fontWeight: 'bold' }}
                />
              </Box>

              <Box sx={{ mt: 1 }}>
                <Typography variant="caption" color="text.secondary" sx={{ mb: 1, display: 'block', textTransform: 'uppercase' }}>
                  文件标签
                </Typography>
                <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
                  {parseTags(item.tags).length > 0 ? (
                    parseTags(item.tags).map((tag, idx) => (
                      <Chip key={idx} label={tag} size="small" variant="filled" sx={{ bgcolor: 'action.selected', borderRadius: BORDER_RADIUS.sm }} />
                    ))
                  ) : (
                    <Typography variant="body2" color="text.disabled">无标签</Typography>
                  )}
                </Box>
              </Box>
            </Box>

            <Divider />

            <Box sx={{ p: 3 }}>
              <Button
                variant="contained"
                fullWidth
                color="error"
                startIcon={<DeleteIcon />}
                onClick={() => {
                  onClose();
                  onDelete([item.id], item.original_name || item.file_name);
                }}
                sx={{ borderRadius: BORDER_RADIUS.md, py: 1.2, fontWeight: 'bold' }}
              >
                删除此文件
              </Button>
              <Button
                fullWidth
                sx={{ mt: 1, color: 'text.secondary' }}
                onClick={() => window.open(`/${item.id}`, '_blank')}
                startIcon={<ImageIcon />}
              >
                查看原图
              </Button>
            </Box>
          </Paper>
        )}
      </Box>
    </Dialog>
  );
};

export default ImageDetailLightbox;
