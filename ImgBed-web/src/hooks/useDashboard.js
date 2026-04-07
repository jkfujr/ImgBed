import { useState, useEffect, useCallback } from 'react';
import { DashboardAPI, SystemConfigDocs, StorageDocs } from '../api';

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

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      // 并行请求所有接口
      const [overviewRes, trendRes, accessRes, storagesRes, quotaRes, cacheRes] =
        await Promise.all([
          DashboardAPI.getOverview(),
          DashboardAPI.getUploadTrend(trendDays),
          DashboardAPI.getAccessStats(),
          StorageDocs.list(),
          SystemConfigDocs.quotaStats(),
          SystemConfigDocs.cacheStats()
        ]);

      // 更新状态
      setOverview(overviewRes.data || overviewRes);
      console.log('Dashboard overview data:', overviewRes.data || overviewRes);
      setUploadTrend(trendRes.data?.trend || trendRes.trend || []);
      setAccessStats(accessRes.data || accessRes);
      setStorages(storagesRes.data?.list || storagesRes.list || []);
      console.log('Storages data:', storagesRes.data?.list || storagesRes.list || []);
      setQuotaStats(quotaRes.data?.stats || quotaRes.stats || {});
      setCacheStats(cacheRes.data || cacheRes);
    } catch (err) {
      console.error('Failed to fetch dashboard data:', err);
      setError(err.message || '加载数据失败');
    } finally {
      setLoading(false);
    }
  }, [trendDays]);

  useEffect(() => {
    fetchData();
    // 30秒自动刷新
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
    refresh: fetchData
  };
}
