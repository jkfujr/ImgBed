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
  const [passwordDialog, setPasswordDialog] = useState({ open: false, onSubmit: null });
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

  const showPasswordDialog = useCallback(() => {
    return new Promise((resolve) => {
      setPasswordDialog({
        open: true,
        onSubmit: (password) => {
          setPasswordDialog({ open: false, onSubmit: null });
          if (password) {
            sessionStorage.setItem('uploadPassword', password);
            resolve(password);
          } else {
            resolve(null);
          }
        }
      });
    });
  }, []);

  const closePasswordDialog = useCallback(() => {
    setPasswordDialog({ open: false, onSubmit: null });
  }, []);

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

  const handleUploadAll = useCallback(async () => {
    const pending = entries.filter((e) => e.status === 'idle' || e.status === 'error');
    if (pending.length === 0) return;
    setUploading(true);

    // 在上传过程中同步统计结果
    let successCount = 0;
    let errorCount = 0;
    let uploadPassword = null;

    for (const entry of pending) {
      patchEntry(entry.id, { status: 'uploading' });
      try {
        const result = await upload(entry.file, { uploadPassword });

        if (result.success) {
          const fullUrl = window.location.origin + result.data.url;
          patchEntry(entry.id, { status: 'done', result: { ...result.data, fullUrl } });
          successCount++;
        } else if (result.needPassword && !uploadPassword) {
          // 需要密码且尚未输入
          const password = await showPasswordDialog();
          if (password) {
            uploadPassword = password;
            // 使用密码重试当前文件
            const retryResult = await upload(entry.file, { uploadPassword });
            if (retryResult.success) {
              const fullUrl = window.location.origin + retryResult.data.url;
              patchEntry(entry.id, { status: 'done', result: { ...retryResult.data, fullUrl } });
              successCount++;
            } else {
              patchEntry(entry.id, { status: 'error', errorMsg: retryResult.error });
              errorCount++;
            }
          } else {
            // 用户取消输入密码
            patchEntry(entry.id, { status: 'error', errorMsg: '已取消上传' });
            errorCount++;
            break; // 停止后续上传
          }
        } else {
          patchEntry(entry.id, { status: 'error', errorMsg: result.error });
          errorCount++;
        }
      } catch (err) {
        const errorMsg = err.response?.data?.message || err.message || '网络错误';
        patchEntry(entry.id, { status: 'error', errorMsg });
        errorCount++;
      }
    }

    setUploading(false);

    // 根据统计结果显示提示
    if (errorCount === 0) {
      showToast('全部上传完成', 'success');
    } else if (successCount === 0) {
      showToast('全部上传失败', 'error');
    } else {
      showToast(`上传完成：成功 ${successCount} 个，失败 ${errorCount} 个`, 'warning');
    }
  }, [entries, showToast, upload, showPasswordDialog]);

  const pendingCount = entries.filter((e) => e.status === 'idle' || e.status === 'error').length;
  const doneCount = entries.filter((e) => e.status === 'done').length;

  return {
    entries, uploading, toast, inputRef,
    pendingCount, doneCount,
    passwordDialog, closePasswordDialog,
    handleFileChange, appendFiles, handleRemove, handleClearDone,
    handleCopy, handleUploadAll, closeToast,
  };
}
