import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import Chip from '@mui/material/Chip';
import Typography from '@mui/material/Typography';
import Stack from '@mui/material/Stack';
import Box from '@mui/material/Box';
import { BarChart } from '@mui/x-charts/BarChart';
import { useTheme } from '@mui/material/styles';
import { BORDER_RADIUS } from '../../../utils/constants';
import { fmtShortDate } from '../../../utils/formatters';

export default function AccessTrendChart({ data }) {
  const theme = useTheme();
  const colorPalette = [
    (theme.vars || theme).palette.primary.dark,
    (theme.vars || theme).palette.primary.main,
  ];

  if (!data || !data.accessTrend || data.accessTrend.length === 0) {
    return (
      <Card variant="outlined" sx={{ width: '100%' }}>
        <CardContent>
          <Typography component="h2" variant="subtitle2" gutterBottom>
            访问趋势
          </Typography>
          <Typography variant="body2" sx={{ color: 'text.secondary' }}>
            暂无访问数据
          </Typography>
        </CardContent>
      </Card>
    );
  }

  // 提取日期和数据
  const dates = data.accessTrend.map(item => fmtShortDate(item.date));

  const accessCounts = data.accessTrend.map(item => item.accessCount || 0);

  // 计算今日访问和增长率
  const todayAccess = data.todayAccess || 0;
  const yesterdayAccess = accessCounts[accessCounts.length - 2] || 0;
  const growthRate = yesterdayAccess > 0
    ? ((todayAccess - yesterdayAccess) / yesterdayAccess * 100).toFixed(1)
    : 0;

  return (
    <Card variant="outlined" sx={{ width: '100%' }}>
      <CardContent>
        <Typography component="h2" variant="subtitle2" gutterBottom>
          访问趋势
        </Typography>
        <Stack sx={{ justifyContent: 'space-between' }}>
          <Stack
            direction="row"
            sx={{
              alignContent: { xs: 'center', sm: 'flex-start' },
              alignItems: 'center',
              gap: 1,
            }}
          >
            <Typography variant="h4" component="p">
              {todayAccess.toLocaleString()}
            </Typography>
            <Chip
              size="small"
              color={growthRate >= 0 ? 'success' : 'error'}
              label={`${growthRate >= 0 ? '+' : ''}${growthRate}%`}
            />
          </Stack>
          <Typography variant="caption" sx={{ color: 'text.secondary' }}>
            今日访问次数 · 独立访客 {data.todayVisitors || 0} 人
          </Typography>
        </Stack>

        {/* 占位空间，与 UploadTrendChart 的 Tabs 高度对齐 */}
        <Box sx={{ mt: 2, mb: 1 }}>
          <Box sx={{ height: 48 }} />
        </Box>

        <BarChart
          borderRadius={BORDER_RADIUS.md * 4}
          colors={colorPalette}
          xAxis={[
            {
              scaleType: 'band',
              categoryGapRatio: 0.5,
              data: dates,
              height: 24,
            },
          ]}
          yAxis={[{ width: 50 }]}
          series={[
            {
              id: 'access-count',
              label: '访问次数',
              data: accessCounts,
            },
          ]}
          height={250}
          margin={{ left: 0, right: 0, top: 20, bottom: 0 }}
          grid={{ horizontal: true }}
          hideLegend
        />
      </CardContent>
    </Card>
  );
}
