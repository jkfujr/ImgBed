import { useState, useEffect, useCallback, useRef } from 'react';
import { StorageDocs, SystemConfigDocs } from '../api';
import { createRequestGuard } from '../utils/request-guard';

export function useLoadBalance() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState(null);
  const [availableChannels, setAvailableChannels] = useState([]);
  const requestGuardRef = useRef(createRequestGuard());

  const [config, setConfig] = useState({
    uploadStrategy: 'default',
    lbStrategy: 'round-robin',
    lbScope: 'global',
    lbEnabledTypes: [],
    lbWeights: {},
    enableFullCheckInterval: true,
    fullCheckIntervalHours: 6,
  });

  useEffect(() => {
    const guard = requestGuardRef.current;
    return () => {
      guard.dispose();
    };
  }, []);

  useEffect(() => {
    const loadConfig = async () => {
      const requestId = requestGuardRef.current.begin();
      setLoading(true);

      try {
        const [lbRes, channelsRes, configRes] = await Promise.all([
          StorageDocs.getLoadBalance().catch(() => ({
            code: -1,
            data: { strategy: 'default' },
          })),
          StorageDocs.list().catch(() => ({
            code: -1,
            data: { list: [] },
          })),
          SystemConfigDocs.get().catch(() => ({ code: -1, data: {} })),
        ]);

        if (!requestGuardRef.current.isCurrent(requestId)) {
          return;
        }

        if (lbRes.code === 0) {
          const strategy = lbRes.data.strategy || 'default';
          setConfig((prev) => ({
            ...prev,
            lbStrategy: strategy === 'default' ? 'round-robin' : strategy,
            lbWeights: lbRes.data.weights || {},
            lbScope: lbRes.data.scope || 'global',
            lbEnabledTypes: lbRes.data.enabledTypes || [],
            uploadStrategy: strategy === 'default' ? 'default' : 'load-balance',
          }));
        }

        if (configRes.code === 0) {
          const uploadConfig = configRes.data.upload || {};
          setConfig((prev) => ({
            ...prev,
            enableFullCheckInterval: (uploadConfig.fullCheckIntervalHours ?? 0) > 0,
            fullCheckIntervalHours: uploadConfig.fullCheckIntervalHours || 6,
          }));
        }

        if (channelsRes.code === 0) {
          setAvailableChannels(channelsRes.data.list || []);
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
    setResult(null);
    setSaving(true);

    try {
      const finalStrategy = config.uploadStrategy === 'default' ? 'default' : config.lbStrategy;
      const [lbRes, sysRes] = await Promise.all([
        StorageDocs.updateLoadBalance({
          strategy: finalStrategy,
          scope: config.lbScope,
          enabledTypes: config.lbEnabledTypes,
          weights: config.lbWeights,
        }),
        SystemConfigDocs.update({
          upload: {
            fullCheckIntervalHours: config.enableFullCheckInterval ? config.fullCheckIntervalHours : 0,
          },
        }),
      ]);

      if (!requestGuardRef.current.isCurrent(requestId)) {
        return;
      }

      if (lbRes.code === 0 && (sysRes.code === 0 || sysRes.response?.status === 200)) {
        setResult({ type: 'success', msg: '存储策略配置已保存' });
      } else {
        setResult({ type: 'error', msg: lbRes.message || sysRes.message || '保存失败' });
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

  const toggleType = useCallback((type) => {
    setConfig((prev) => ({
      ...prev,
      lbEnabledTypes: prev.lbEnabledTypes.includes(type)
        ? prev.lbEnabledTypes.filter((item) => item !== type)
        : [...prev.lbEnabledTypes, type],
    }));
  }, []);

  return { loading, saving, result, config, setConfig, availableChannels, clearResult, handleSave, toggleType };
}
