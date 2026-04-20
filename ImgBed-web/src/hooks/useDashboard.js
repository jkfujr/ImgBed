import { useState, useEffect, useCallback, useRef } from 'react';
import { DashboardAPI, SystemConfigDocs, StorageDocs } from '../api';
import { createRequestGuard } from '../utils/request-guard';

export function useDashboard() {
  const [overview, setOverview] = useState(null);
  const [uploadTrend, setUploadTrend] = useState([]);
  const [accessStats, setAccessStats] = useState(null);
  const [storages, setStorages] = useState([]);
  const [quotaStats, setQuotaStats] = useState({});
  const [cacheStats, setCacheStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [trendDays, setTrendDays] = useState(30);
  const requestGuardRef = useRef(createRequestGuard());

  useEffect(() => {
    const guard = requestGuardRef.current;
    return () => {
      guard.dispose();
    };
  }, []);

  const fetchData = useCallback(async (force = false) => {
    const requestId = requestGuardRef.current.begin();
    setLoading(true);
    setError(null);

    try {
      // 第一优先级：核心概览数据（最快，用户最关心）
      const overviewPromise = DashboardAPI.getOverview(force);
      const accessStatsPromise = DashboardAPI.getAccessStats(force);

      // 第二优先级：趋势图数据
      const trendPromise = DashboardAPI.getUploadTrend(trendDays, force);

      // 第三优先级：配置数据
      const storagesPromise = StorageDocs.list(force);
      const quotaPromise = SystemConfigDocs.quotaStats(force);
      const cachePromise = SystemConfigDocs.cacheStats(force);

      // 先加载核心数据，立即显示
      const [overviewRes, accessRes] = await Promise.all([
        overviewPromise,
        accessStatsPromise,
      ]);

      if (!requestGuardRef.current.isCurrent(requestId)) {
        return;
      }

      setOverview(overviewRes.data || overviewRes);
      setAccessStats(accessRes.data || accessRes);
      setLoading(false); // 核心数据加载完成，停止 loading

      // 后台继续加载次要数据
      const [trendRes, storagesRes, quotaRes, cacheRes] = await Promise.all([
        trendPromise,
        storagesPromise,
        quotaPromise,
        cachePromise,
      ]);

      if (!requestGuardRef.current.isCurrent(requestId)) {
        return;
      }

      setUploadTrend(trendRes.data?.trend || trendRes.trend || []);
      setStorages(storagesRes.data?.list || storagesRes.list || []);
      setQuotaStats(quotaRes.data?.stats || quotaRes.stats || {});
      setCacheStats(cacheRes.data || cacheRes);
    } catch (err) {
      if (!requestGuardRef.current.isCurrent(requestId)) {
        return;
      }

      console.error('加载仪表盘数据失败:', err);
      setError(err.message || '加载数据失败');
      setLoading(false);
    }
  }, [trendDays]);

  // 手动刷新函数（绕过缓存）
  const refresh = useCallback(() => {
    fetchData(true); // force = true
  }, [fetchData]);

  const fetchDataRef = useRef(fetchData);
  useEffect(() => {
    fetchDataRef.current = fetchData;
  }, [fetchData]);

  useEffect(() => {
    const tick = () => fetchDataRef.current(false);
    tick();
    const interval = setInterval(tick, 30000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    fetchDataRef.current(false);
  }, [trendDays]);

  return {
    overview,
    uploadTrend,
    accessStats,
    storages,
    quotaStats,
    cacheStats,
    loading,
    error,
    trendDays,
    setTrendDays,
    refresh,
  };
}
