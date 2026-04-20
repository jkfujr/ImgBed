import { useState } from 'react';
import { Box, IconButton, Dialog, useTheme, useMediaQuery } from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import useImageTransform from '../../hooks/useImageTransform';
import ImageDetailPanel from './ImageDetailPanel';
import { BORDER_RADIUS } from '../../utils/constants';
import { buildAdminMediaSrc, shouldUseVideoFallback } from '../../admin/mediaPreviewShared';

export default function ImageDetailLightbox({ open, item, onClose, onDelete }) {
  const theme = useTheme();
  const isLg = useMediaQuery(theme.breakpoints.up('lg'));
  const [previewMode, setPreviewMode] = useState('image');
  const previewKey = `${open ? '1' : '0'}|${item?.id ?? ''}`;
  const [prevPreviewKey, setPrevPreviewKey] = useState(previewKey);
  if (prevPreviewKey !== previewKey) {
    setPrevPreviewKey(previewKey);
    setPreviewMode('image');
  }

  const {
    containerRef,
    imgTransform,
    isDragging,
    isReady,
    isImageLoaded,
    shouldAnimate,
    showZoomIndicator,
    handleImageLoad,
    handleMouseDown,
  } = useImageTransform({ open, item });

  const allowVideoFallback = shouldUseVideoFallback(item);
  const mediaSrc = buildAdminMediaSrc(item);
  const showVideo = previewMode === 'video';

  if (!item) return null;

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
            cursor: showVideo ? 'default' : (isDragging ? 'grabbing' : 'grab'),
            userSelect: 'none'
          }}
          onMouseDown={showVideo ? undefined : handleMouseDown}
        >
          {showVideo ? (
            <Box
              component="video"
              src={mediaSrc}
              autoPlay
              muted
              loop
              playsInline
              controls
              sx={{
                width: 'min(90vw, 960px)',
                maxWidth: '100%',
                maxHeight: '90vh',
                borderRadius: BORDER_RADIUS.md,
                boxShadow: '0 0 20px rgba(0,0,0,0.5)',
              }}
            />
          ) : (
            <Box
              component="img"
              src={mediaSrc}
              alt={item.original_name || item.file_name}
              draggable={false}
              onLoad={handleImageLoad}
              onError={() => {
                if (allowVideoFallback) {
                  setPreviewMode('video');
                }
              }}
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
          )}

          {/* 缩放倍率提示 */}
          {!showVideo && (
            <Box
              sx={{
                position: 'absolute',
                top: '50%',
                left: '50%',
                transform: 'translate(-50%, -50%)',
                bgcolor: 'rgba(0, 0, 0, 0.75)',
                color: 'white',
                px: 3,
                py: 1.5,
                borderRadius: BORDER_RADIUS.md,
                fontSize: '1.5rem',
                fontWeight: 'bold',
                pointerEvents: 'none',
                opacity: showZoomIndicator ? 1 : 0,
                transition: 'opacity 0.2s ease-in-out',
                zIndex: 50
              }}
            >
              {Math.round(imgTransform.scale * 100)}%
            </Box>
          )}
        </Box>

        {isLg && (
          <ImageDetailPanel item={item} theme={theme} onDelete={onDelete} />
        )}
      </Box>
    </Dialog>
  );
}
