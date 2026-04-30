export function formatObjectSize(size) {
  const bytes = Number(size || 0);
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

export function formatObjectTime(value) {
  if (!value) return '未知时间';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '未知时间';
  return date.toLocaleString();
}

export function summarizeExistingObjects(existingObjects) {
  const items = existingObjects?.items || [];
  return {
    hasItems: items.length > 0,
    countLabel: `${items.length} 条`,
    truncatedLabel: existingObjects?.isTruncated ? '仅显示部分' : '',
  };
}
