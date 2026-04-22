function endsWithGif(value) {
  return typeof value === 'string' && value.toLowerCase().endsWith('.gif');
}

function buildFileViewPath(fileId) {
  return fileId ? `/${encodeURIComponent(fileId)}` : '';
}

function shouldUseVideoFallback(item) {
  if (!item || typeof item !== 'object') {
    return false;
  }

  const mimeType = String(item.mime_type || '').toLowerCase();
  if (mimeType === 'image/gif') {
    return true;
  }

  return endsWithGif(item.original_name) || endsWithGif(item.file_name) || endsWithGif(item.id);
}

function buildAdminMediaSrc(item) {
  return buildFileViewPath(item?.id);
}

export {
  buildAdminMediaSrc,
  buildFileViewPath,
  shouldUseVideoFallback,
};
