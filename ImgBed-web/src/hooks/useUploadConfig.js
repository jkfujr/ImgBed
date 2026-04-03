import { useState, useEffect, useCallback } from 'react';
import { SystemConfigDocs } from '../api';

/**
 * 上传配置 Hook — 封装 UploadConfigPanel 的全部状态与操作
 * @returns {{ loading, saving, result, config, setConfig, clearResult, handleSave }}
 */
export function useUploadConfig() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState(null);

  const [config, setConfig] = useState({
    quotaCheckMode: 'auto',
    fullCheckIntervalHours: 6,
    enableSizeLimit: false,
    enableChunking: false,
    enableMaxLimit: false,
    defaultSizeLimitMB: 10,
    defaultChunkSizeMB: 5,
    defaultMaxChunks: 0,
    defaultMaxLimitMB: 100,
  });

  useEffect(() => {
    const loadConfig = async () => {
      setLoading(true);
      try {
        const res = await SystemConfigDocs.get();
        if (res.code === 0) {
          const u = res.data.upload || {};
          setConfig({
            quotaCheckMode: u.quotaCheckMode || 'auto',
            fullCheckIntervalHours: u.fullCheckIntervalHours || 6,
            enableSizeLimit: u.enableSizeLimit ?? false,
            defaultSizeLimitMB: u.defaultSizeLimitMB || 10,
            enableChunking: u.enableChunking ?? false,
            defaultChunkSizeMB: u.defaultChunkSizeMB || 5,
            defaultMaxChunks: u.defaultMaxChunks ?? 0,
            enableMaxLimit: u.enableMaxLimit ?? false,
            defaultMaxLimitMB: u.defaultMaxLimitMB || 100,
          });
        }
      } catch {
        setResult({ type: 'error', msg: '加载配置失败，请检查网络或后端服务' });
      } finally {
        setLoading(false);
      }
    };

    loadConfig();
  }, []);

  const handleSave = useCallback(async () => {
    setSaving(true);
    try {
      const res = await SystemConfigDocs.update({ upload: config });
      if (res.code === 0) {
        setResult({ type: 'success', msg: '上传配置已保存，重启服务后定时间隔生效' });
      } else {
        setResult({ type: 'error', msg: res.message || '保存失败' });
      }
    } catch (err) {
      setResult({ type: 'error', msg: err.response?.data?.message || '网络错误' });
    } finally {
      setSaving(false);
    }
  }, [config]);

  const clearResult = useCallback(() => setResult(null), []);

  return { loading, saving, result, config, setConfig, clearResult, handleSave };
}
