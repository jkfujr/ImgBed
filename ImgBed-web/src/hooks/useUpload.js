import { useState, useCallback } from 'react';
import { UploadDocs } from '../api';
import { useRefresh } from '../contexts/RefreshContext';

/**
 * 统一的文件上传 Hook
 * @param {Object} config - 配置选项
 * @param {string} config.refreshMode - 刷新模式：'none' | 'global' | 'callback'
 * @param {Function} config.onRefresh - refreshMode='callback' 时的刷新回调
 * @param {Function} config.onSuccess - 上传成功回调
 * @param {Function} config.onError - 上传失败回调
 */
export function useUpload(config = {}) {
  const {
    refreshMode = 'none',
    onRefresh,
    onSuccess,
    onError
  } = config;

  const { triggerRefresh } = useRefresh();
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState(null);
  const [result, setResult] = useState(null);

  const upload = useCallback(async (file, options = {}) => {
    setUploading(true);
    setProgress(0);
    setError(null);
    setResult(null);

    try {
      const res = await UploadDocs.upload(file, {
        ...options,
        onUploadProgress: (progressEvent) => {
          const total = progressEvent.total || progressEvent.loaded || 1;
          const percentCompleted = Math.min(100, Math.round((progressEvent.loaded * 100) / total));
          setProgress(percentCompleted);
          options.onProgress?.(percentCompleted);
        }
      });

      if (res.code === 0) {
        setResult(res.data);
        onSuccess?.(res.data);

        // 根据刷新模式处理
        if (refreshMode === 'global') {
          triggerRefresh();
        } else if (refreshMode === 'callback' && onRefresh) {
          onRefresh();
        }

        return { success: true, data: res.data };
      }

      throw new Error(res.message || '上传失败');
    } catch (err) {
      const errorMsg = err.response?.data?.message || err.message || '上传失败';
      setError(errorMsg);
      onError?.(errorMsg);
      return { success: false, error: errorMsg };
    } finally {
      setUploading(false);
    }
  }, [refreshMode, onRefresh, onSuccess, onError, triggerRefresh]);

  const reset = useCallback(() => {
    setUploading(false);
    setProgress(0);
    setError(null);
    setResult(null);
  }, []);

  return {
    upload,
    uploading,
    progress,
    error,
    result,
    reset
  };
}
