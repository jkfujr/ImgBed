import { useState, useRef, useEffect, useCallback } from 'react';
import { useUpload } from './useUpload';
import { ALLOWED_IMAGE_EXTENSIONS } from '../utils/constants';

const createFileEntry = (file) => ({
  id: Math.random().toString(36).slice(2),
  file,
  previewUrl: URL.createObjectURL(file),
  status: 'idle',
  result: null,
  errorMsg: null,
});

/**
 * 首页上传逻辑 Hook — 管理文件列表、上传状态、toast 提示
 */
export function useHomeUpload() {
  const [entries, setEntries] = useState([]);
  const [uploading, setUploading] = useState(false);
  const { upload } = useUpload({ refreshMode: 'none' });
  const [toast, setToast] = useState({ open: false, msg: '', type: 'info' });
  const inputRef = useRef(null);
  const entriesRef = useRef([]);

  useEffect(() => {
    entriesRef.current = entries;
  }, [entries]);

  useEffect(() => () => {
    entriesRef.current.forEach((entry) => {
      if (entry.previewUrl) URL.revokeObjectURL(entry.previewUrl);
    });
  }, []);

  const showToast = useCallback((msg, type = 'info') => setToast({ open: true, msg, type }), []);
  const closeToast = useCallback(() => setToast((prev) => ({ ...prev, open: false })), []);

  const patchEntry = (id, patch) =>
    setEntries((prev) => prev.map((e) => (e.id === id ? { ...e, ...patch } : e)));

  const revokeEntryPreview = (entry) => {
    if (entry?.previewUrl) URL.revokeObjectURL(entry.previewUrl);
  };

  const isAllowedImage = (fileName) => {
    const lower = fileName.toLowerCase();
    return ALLOWED_IMAGE_EXTENSIONS.some((ext) => lower.endsWith(ext));
  };

  const collectValidImages = useCallback((files) => {
    const valid = [];
    files.forEach((f) => {
      const isImageType = f.type.startsWith('image/');
      const isAllowedExt = isAllowedImage(f.name);
      if (!isImageType && !isAllowedExt) {
        showToast(`「${f.name}」不是图片，已跳过`, 'warning');
        return;
      }
      valid.push(f);
    });
    return valid;
  }, [showToast]);

  const appendFiles = useCallback((files) => {
    const valid = collectValidImages(files);
    if (valid.length > 0) {
      setEntries((prev) => [...prev, ...valid.map(createFileEntry)]);
    }
  }, [collectValidImages]);

  const handleFileChange = useCallback((e) => {
    appendFiles(Array.from(e.target.files || []));
    e.target.value = null;
  }, [appendFiles]);

  const handleRemove = useCallback((id) => {
    setEntries((prev) => {
      const target = prev.find((e) => e.id === id);
      revokeEntryPreview(target);
      return prev.filter((e) => e.id !== id);
    });
  }, []);

  const handleClearDone = useCallback(() => {
    setEntries((prev) => {
      prev.filter((e) => e.status === 'done').forEach(revokeEntryPreview);
      return prev.filter((e) => e.status !== 'done');
    });
  }, []);

  const handleCopy = useCallback((text) => {
    navigator.clipboard.writeText(text);
    showToast('已复制到剪贴板', 'success');
  }, [showToast]);

  const uploadOne = useCallback(async (entry) => {
    patchEntry(entry.id, { status: 'uploading' });
    try {
      const result = await upload(entry.file);
      if (result.success) {
        const fullUrl = window.location.origin + result.data.url;
        patchEntry(entry.id, { status: 'done', result: { ...result.data, fullUrl } });
      } else {
        patchEntry(entry.id, { status: 'error', errorMsg: result.error });
      }
    } catch (err) {
      patchEntry(entry.id, {
        status: 'error',
        errorMsg: err.response?.data?.message || err.message || '网络错误',
      });
    }
  }, [upload]);

  const handleUploadAll = useCallback(async () => {
    const pending = entries.filter((e) => e.status === 'idle' || e.status === 'error');
    if (pending.length === 0) return;
    setUploading(true);
    for (const entry of pending) {
      await uploadOne(entry);
    }
    setUploading(false);
    showToast('全部上传完成', 'success');
  }, [entries, showToast, uploadOne]);

  const pendingCount = entries.filter((e) => e.status === 'idle' || e.status === 'error').length;
  const doneCount = entries.filter((e) => e.status === 'done').length;

  return {
    entries, uploading, toast, inputRef,
    pendingCount, doneCount,
    handleFileChange, appendFiles, handleRemove, handleClearDone,
    handleCopy, handleUploadAll, closeToast,
  };
}
