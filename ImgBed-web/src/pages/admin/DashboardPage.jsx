import Box from '@mui/material/Box';
import Grid from '@mui/material/Grid';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import IconButton from '@mui/material/IconButton';
import RefreshIcon from '@mui/icons-material/Refresh';
import CircularProgress from '@mui/material/CircularProgress';
import Alert from '@mui/material/Alert';
import { useDashboard } from '../../hooks/useDashboard';
import StatCard from '../../components/admin/dashboard/StatCard';
import HighlightedCard from '../../components/admin/dashboard/HighlightedCard';
import UploadTrendChart from '../../components/admin/dashboard/UploadTrendChart';
import AccessTrendChart from '../../components/admin/dashboard/AccessTrendChart';
import StorageDataGrid from '../../components/admin/dashboard/StorageDataGrid';
import TopFilesTree from '../../components/admin/dashboard/TopFilesTree';
import CacheStatsCard from '../../components/admin/dashboard/CacheStatsCard';
import { fmtSize } from '../../utils/formatters';

export default function DashboardPage() {
  const {
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
  } = useDashboard();

  // 计算 StatCard 数据
  const getStatCardData = () => {
    if (!overview || !uploadTrend) return [];

    // 提取趋势数据
    const fileCounts = uploadTrend.map(item => item.fileCount || 0);
    const totalSizes = uploadTrend.map(item => item.totalSize || 0);

    return [
      {
        title: '总文件数',
        value: overview.totalFiles?.toLocaleString() || '0',
        interval: '所有文件',
        trend: 'up',
        data: fileCounts,
      },
      {
        title: '总存储量',
        value: fmtSize(overview.totalSize || 0),
        interval: '已使用空间',
        trend: 'up',
        data: totalSizes.map(size => size / (1024 * 1024)), // 转换为 MB
      },
      {
        title: '今日上传',
        value: overview.todayUploads?.toString() || '0',
        interval: '今天上传的文件',
        trend: overview.todayUploads > 0 ? 'up' : 'neutral',
        data: fileCounts.slice(-7), // 最近7天
      },
    ];
  };

  const statCards = getStatCardData();

  if (loading && !overview) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: 400 }}>
        <CircularProgress />
      </Box>
    );
  }

  return (
    <Box sx={{ width: '100%', maxWidth: { sm: '100%', md: '1700px' } }}>
      {/* 页面标题和刷新按钮 */}
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
        <Typography component="h1" variant="h4">
          仪表盘
        </Typography>
        <IconButton onClick={refresh} disabled={loading}>
          <RefreshIcon />
        </IconButton>
      </Box>

      {/* 错误提示 */}
      {error && (
        <Alert severity="error" sx={{ mb: 2 }}>
          {error}
        </Alert>
      )}

      {/* 概览区域 */}
      <Typography component="h2" variant="h6" sx={{ mb: 2 }}>
        概览
      </Typography>
      <Grid container spacing={2} columns={12} sx={{ mb: 2 }}>
        {statCards.map((card, index) => (
          <Grid key={index} size={{ xs: 12, sm: 6, lg: 3 }}>
            <StatCard {...card} />
          </Grid>
        ))}
        <Grid size={{ xs: 12, sm: 6, lg: 3 }}>
          <HighlightedCard
            enabledChannels={overview?.enabledChannels}
            totalChannels={overview?.totalChannels}
          />
        </Grid>

        {/* 上传趋势图 */}
        <Grid size={{ xs: 12, md: 6 }}>
          <UploadTrendChart
            data={uploadTrend}
            days={trendDays}
            onDaysChange={setTrendDays}
          />
        </Grid>

        {/* 访问趋势图 */}
        <Grid size={{ xs: 12, md: 6 }}>
          <AccessTrendChart data={accessStats} />
        </Grid>
      </Grid>

      {/* 详情区域 */}
      <Typography component="h2" variant="h6" sx={{ mb: 2 }}>
        详情
      </Typography>
      <Grid container spacing={2} columns={12}>
        {/* 存储渠道状态表格 */}
        <Grid size={{ xs: 12, lg: 9 }}>
          <StorageDataGrid storages={storages} quotaStats={quotaStats} />
        </Grid>

        {/* 侧边栏：热门文件 + 缓存统计 */}
        <Grid size={{ xs: 12, lg: 3 }}>
          <Stack spacing={2}>
            <TopFilesTree data={accessStats} />
            <CacheStatsCard data={cacheStats} />
          </Stack>
        </Grid>
      </Grid>
    </Box>
  );
}
