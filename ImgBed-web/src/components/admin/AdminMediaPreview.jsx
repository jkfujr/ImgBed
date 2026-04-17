import { useEffect, useState } from 'react';
import { Box } from '@mui/material';
import { buildAdminMediaSrc, shouldUseVideoFallback } from '../../admin/mediaPreviewShared';

export default function AdminMediaPreview({
  item,
  alt,
  onClick,
  sx,
  imgProps = {},
  videoProps = {},
}) {
  const [previewMode, setPreviewMode] = useState('image');
  const src = buildAdminMediaSrc(item);
  const allowVideoFallback = shouldUseVideoFallback(item);
  const {
    onError: onImageError,
    ...restImgProps
  } = imgProps;
  const {
    onError: onVideoError,
    ...restVideoProps
  } = videoProps;

  useEffect(() => {
    setPreviewMode('image');
  }, [item?.id]);

  if (!src) {
    return null;
  }

  if (previewMode === 'video') {
    return (
      <Box
        component="video"
        {...restVideoProps}
        src={src}
        onClick={onClick}
        onError={onVideoError}
        autoPlay
        muted
        loop
        playsInline
        preload="metadata"
        sx={sx}
      />
    );
  }

  return (
    <Box
      component="img"
      {...restImgProps}
      src={src}
      alt={alt}
      onClick={onClick}
      onError={(event) => {
        onImageError?.(event);
        if (allowVideoFallback) {
          setPreviewMode('video');
        }
      }}
      sx={sx}
    />
  );
}
