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
    return () => {
      requestGuardRef.current.dispose();
    };
  }, []);

  const fetchData = useCallback(async () => {
    const requestId = requestGuardRef.current.begin();
    setLoading(true);
    setError(null);

    try {
      const [overviewRes, trendRes, accessRes, storagesRes, quotaRes, cacheRes] = await Promise.all([
        DashboardAPI.getOverview(),
        DashboardAPI.getUploadTrend(trendDays),
        DashboardAPI.getAccessStats(),
        StorageDocs.list(),
        SystemConfigDocs.quotaStats(),
        SystemConfigDocs.cacheStats(),
      ]);

      if (!requestGuardRef.current.isCurrent(requestId)) {
        return;
      }

      setOverview(overviewRes.data || overviewRes);
      setUploadTrend(trendRes.data?.trend || trendRes.trend || []);
      setAccessStats(accessRes.data || accessRes);
      setStorages(storagesRes.data?.list || storagesRes.list || []);
      setQuotaStats(quotaRes.data?.stats || quotaRes.stats || {});
      setCacheStats(cacheRes.data || cacheRes);
    } catch (err) {
      if (!requestGuardRef.current.isCurrent(requestId)) {
        return;
      }

      console.error('加载仪表盘数据失败:', err);
      setError(err.message || '加载数据失败');
    } finally {
      if (requestGuardRef.current.isCurrent(requestId)) {
        setLoading(false);
      }
    }
  }, [trendDays]);

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 30000);
    return () => clearInterval(interval);
  }, [fetchData]);

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
    refresh: fetchData,
  };
}
