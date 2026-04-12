import { useState, useEffect, useCallback, useRef } from 'react';
import { SystemConfigDocs, StorageDocs } from '../api';
import { createRequestGuard } from '../utils/request-guard';

export function useUploadConfig() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState(null);
  const requestGuardRef = useRef(createRequestGuard());

  const [config, setConfig] = useState({
    failoverEnabled: true,
    enableS3Concurrent: false,
    enableSizeLimit: false,
    enableChunking: false,
    enableMaxLimit: false,
    defaultSizeLimitMB: 10,
    defaultChunkSizeMB: 5,
    defaultMaxChunks: 0,
    defaultMaxLimitMB: 100,
  });

  useEffect(() => {
    return () => {
      requestGuardRef.current.dispose();
    };
  }, []);

  useEffect(() => {
    const loadConfig = async () => {
      const requestId = requestGuardRef.current.begin();
      setLoading(true);

      try {
        const [sysRes, lbRes] = await Promise.all([
          SystemConfigDocs.get(),
          StorageDocs.getLoadBalance().catch(() => ({ code: -1, data: {} })),
        ]);

        if (!requestGuardRef.current.isCurrent(requestId)) {
          return;
        }

        if (sysRes.code === 0) {
          const uploadConfig = sysRes.data.upload || {};
          const performanceConfig = sysRes.data.performance?.s3Multipart || {};
          setConfig({
            failoverEnabled: lbRes.code === 0 ? (lbRes.data.failoverEnabled !== false) : true,
            enableS3Concurrent: performanceConfig.enabled ?? false,
            enableSizeLimit: uploadConfig.enableSizeLimit ?? false,
            defaultSizeLimitMB: uploadConfig.defaultSizeLimitMB || 10,
            enableChunking: uploadConfig.enableChunking ?? false,
            defaultChunkSizeMB: uploadConfig.defaultChunkSizeMB || 5,
            defaultMaxChunks: uploadConfig.defaultMaxChunks ?? 0,
            enableMaxLimit: uploadConfig.enableMaxLimit ?? false,
            defaultMaxLimitMB: uploadConfig.defaultMaxLimitMB || 100,
          });
        }
      } catch {
        if (!requestGuardRef.current.isCurrent(requestId)) {
          return;
        }

        setResult({ type: 'error', msg: '加载配置失败，请检查网络或后端服务' });
      } finally {
        if (requestGuardRef.current.isCurrent(requestId)) {
          setLoading(false);
        }
      }
    };

    loadConfig();
  }, []);

  const handleSave = useCallback(async () => {
    const requestId = requestGuardRef.current.begin();
    setSaving(true);

    try {
      const uploadConfig = {
        enableSizeLimit: config.enableSizeLimit,
        defaultSizeLimitMB: config.defaultSizeLimitMB,
        enableChunking: config.enableChunking,
        defaultChunkSizeMB: config.defaultChunkSizeMB,
        defaultMaxChunks: config.defaultMaxChunks,
        enableMaxLimit: config.enableMaxLimit,
        defaultMaxLimitMB: config.defaultMaxLimitMB,
      };

      const performanceConfig = {
        s3Multipart: {
          enabled: config.enableS3Concurrent,
          concurrency: 4,
          maxConcurrency: 8,
        },
      };

      const [sysRes, lbRes] = await Promise.all([
        SystemConfigDocs.update({
          upload: uploadConfig,
          performance: performanceConfig,
        }),
        StorageDocs.updateLoadBalance({
          failoverEnabled: config.failoverEnabled,
        }),
      ]);

      if (!requestGuardRef.current.isCurrent(requestId)) {
        return;
      }

      if ((sysRes.code === 0 || sysRes.response?.status === 200) && lbRes.code === 0) {
        setResult({ type: 'success', msg: '上传配置已保存，重启服务后生效' });
      } else {
        setResult({ type: 'error', msg: sysRes.message || lbRes.message || '保存失败' });
      }
    } catch (err) {
      if (!requestGuardRef.current.isCurrent(requestId)) {
        return;
      }

      setResult({ type: 'error', msg: err.response?.data?.message || '网络错误' });
    } finally {
      if (requestGuardRef.current.isCurrent(requestId)) {
        setSaving(false);
      }
    }
  }, [config]);

  const clearResult = useCallback(() => setResult(null), []);

  return { loading, saving, result, config, setConfig, clearResult, handleSave };
}
