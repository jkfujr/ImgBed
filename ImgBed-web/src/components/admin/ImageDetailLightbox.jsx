import React, { useState, useCallback, useEffect, useRef } from 'react';
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
  const [isReady, setIsReady] = useState(false);
  const [isImageLoaded, setIsImageLoaded] = useState(false);
  const [shouldAnimate, setShouldAnimate] = useState(false);

  const containerRef = useRef(null);
  const transformMapRef = useRef({}); // 每张图的独立缩放/位移状态
  const itemIdRef = useRef(null);     // 当前图片 id，供回调读取

  // 计算初始自适应缩放（同步逻辑，不依赖 Effect）
  const calculateInitialScale = useCallback((targetItem, container) => {
    if (!targetItem || !container) return { x: 0, y: 0, scale: 1 };

    const containerWidth = container.clientWidth;
    const containerHeight = container.clientHeight;
    if (containerWidth === 0 || containerHeight === 0) return { x: 0, y: 0, scale: 1 };

    let initialScale = 1;
    const imgW = Number(targetItem.width) || 0;
    const imgH = Number(targetItem.height) || 0;

    if (imgW > 0 && imgH > 0) {
      const containerRatio = containerWidth / containerHeight;
      const imgRatio = imgW / imgH;

      if (imgRatio > containerRatio) {
        initialScale = (containerWidth * 0.9) / imgW;
      } else {
        initialScale = (containerHeight * 0.9) / imgH;
      }
      initialScale = Math.min(Math.max(initialScale, 0.01), 1);
    }
    return { x: 0, y: 0, scale: initialScale };
  }, []);

  // 核心：打开或切换图片时计算并应用缩放
  useEffect(() => {
    if (!open || !item) {
      // 异步重置，避免同步 setState 警告
      Promise.resolve().then(() => {
        setIsReady(false);
        setIsImageLoaded(false);
        setShouldAnimate(false);
      });
      itemIdRef.current = null;
      return;
    }

    itemIdRef.current = item.id;

    const applyTransform = () => {
      const container = containerRef.current;
      if (!container) return;

      let state = transformMapRef.current[item.id];
      if (!state) {
        state = calculateInitialScale(item, container);
        transformMapRef.current[item.id] = state;
      }

      setImgTransform(state);
      setIsReady(true);
      setShouldAnimate(false);
    };

    // 首次尝试（DOM 可能已就绪）
    requestAnimationFrame(applyTransform);

    // Dialog 动画结束后再校正一次并开启动画
    const timer = setTimeout(() => {
      applyTransform();
      setShouldAnimate(true);
    }, 150);

    return () => clearTimeout(timer);
  }, [open, item, calculateInitialScale]);

  // 状态变更同步到 Map（通过 ref 读取 id，避免依赖 item）
  const updateTransform = useCallback((newStateOrUpdater) => {
    setImgTransform(prev => {
      const next = typeof newStateOrUpdater === 'function' ? newStateOrUpdater(prev) : newStateOrUpdater;
      const currentId = itemIdRef.current;
      if (currentId) {
        transformMapRef.current[currentId] = next;
      }
      return next;
    });
  }, []);

  const handleImageLoad = useCallback(() => {
    setIsImageLoaded(true);
    // 如果图片加载完发现还没有计算过（虽然 useEffect 已经算了，但万一尺寸有变），补算一次
    if (containerRef.current && item) {
      const container = containerRef.current;
      // 如果是第一次加载，或者尺寸异常，重新算并更新
      if (!transformMapRef.current[item.id] || transformMapRef.current[item.id].scale === 1) {
        const state = calculateInitialScale(item, container);
        updateTransform(state);
      }
    }
  }, [item, calculateInitialScale, updateTransform]);

  const handleWheel = useCallback((e) => {
    if (!isReady) return;
    e.preventDefault();
    const delta = e.deltaY > 0 ? 0.9 : 1.1;
    updateTransform(prev => ({
      ...prev,
      scale: Math.min(Math.max(prev.scale * delta, 0.01), 50)
    }));
  }, [isReady, updateTransform]);

  // 绑定非被动 Wheel 事件
  useEffect(() => {
    const node = containerRef.current;
    if (open && node) {
      const wheelHandler = (e) => handleWheel(e);
      node.addEventListener('wheel', wheelHandler, { passive: false });
      return () => node.removeEventListener('wheel', wheelHandler);
    }
  }, [open, handleWheel]);

  const handleMouseDown = (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    setIsDragging(true);
    setDragStart({ x: e.clientX, y: e.clientY });
  };

  const handleMouseMove = useCallback((e) => {
    if (!isDragging) return;
    const dx = e.clientX - dragStart.x;
    const dy = e.clientY - dragStart.y;
    updateTransform(prev => ({
      ...prev,
      x: prev.x + dx,
      y: prev.y + dy
    }));
    setDragStart({ x: e.clientX, y: e.clientY });
  }, [isDragging, dragStart, updateTransform]);

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
          onMouseDown={handleMouseDown}
        >
          <Box
            component="img"
            src={`/${item.id}`}
            alt={item.original_name || item.file_name}
            draggable={false}
            onLoad={handleImageLoad}
            sx={{
              width: item.width ? `${item.width}px` : 'auto',
              height: item.height ? `${item.height}px` : 'auto',
              maxWidth: 'none',
              maxHeight: 'none',
              opacity: isReady && isImageLoaded ? 1 : 0,
              transform: `translate(${imgTransform.x}px, ${imgTransform.y}px) scale(${imgTransform.scale})`,
              transformOrigin: 'center center',
              transition: (!shouldAnimate || isDragging) ? 'opacity 0.3s' : 'transform 0.15s cubic-bezier(0.4, 0, 0.2, 1), opacity 0.3s',
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
