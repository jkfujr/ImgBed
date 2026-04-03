import { useState, useEffect, useCallback } from 'react';
import { StorageDocs } from '../api';

/**
 * 负载均衡配置 Hook — 封装 LoadBalancePanel 的全部状态与操作
 */
export function useLoadBalance() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState(null);
  const [availableChannels, setAvailableChannels] = useState([]);

  const [config, setConfig] = useState({
    uploadStrategy: 'default',
    lbStrategy: 'round-robin',
    lbScope: 'global',
    lbEnabledTypes: [],
    lbWeights: {},
    failoverEnabled: true,
  });

  useEffect(() => {
    const loadConfig = async () => {
      setLoading(true);
      try {
        const [lbRes, channelsRes] = await Promise.all([
          StorageDocs.getLoadBalance().catch(() => ({
            code: -1,
            data: { strategy: 'default' }
          })),
          StorageDocs.list().catch(() => ({
            code: -1,
            data: { list: [] }
          }))
        ]);

        if (lbRes.code === 0) {
          const strategy = lbRes.data.strategy || 'default';
          setConfig({
            lbStrategy: strategy === 'default' ? 'round-robin' : strategy,
            lbWeights: lbRes.data.weights || {},
            lbScope: lbRes.data.scope || 'global',
            lbEnabledTypes: lbRes.data.enabledTypes || [],
            failoverEnabled: lbRes.data.failoverEnabled !== false,
            uploadStrategy: strategy === 'default' ? 'default' : 'load-balance',
          });
        }

        if (channelsRes.code === 0) {
          setAvailableChannels(channelsRes.data.list || []);
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
    setResult(null);
    setSaving(true);
    try {
      const finalStrategy = config.uploadStrategy === 'default' ? 'default' : config.lbStrategy;
      const res = await StorageDocs.updateLoadBalance({
        strategy: finalStrategy,
        scope: config.lbScope,
        enabledTypes: config.lbEnabledTypes,
        weights: config.lbWeights,
        failoverEnabled: config.failoverEnabled,
      });
      if (res.code === 0) {
        setResult({ type: 'success', msg: '负载均衡配置已保存' });
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

  const toggleType = useCallback((type) => {
    setConfig(prev => ({
      ...prev,
      lbEnabledTypes: prev.lbEnabledTypes.includes(type)
        ? prev.lbEnabledTypes.filter(t => t !== type)
        : [...prev.lbEnabledTypes, type],
    }));
  }, []);

  return { loading, saving, result, config, setConfig, availableChannels, clearResult, handleSave, toggleType };
}
