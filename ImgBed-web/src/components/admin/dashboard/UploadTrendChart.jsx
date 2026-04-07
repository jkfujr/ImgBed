import { useTheme } from '@mui/material/styles';
import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import Chip from '@mui/material/Chip';
import Typography from '@mui/material/Typography';
import Stack from '@mui/material/Stack';
import Tabs from '@mui/material/Tabs';
import Tab from '@mui/material/Tab';
import Box from '@mui/material/Box';
import { LineChart } from '@mui/x-charts/LineChart';
import { fmtSize } from '../../../utils/formatters';

function AreaGradient({ color, id }) {
  return (
    <defs>
      <linearGradient id={id} x1="50%" y1="0%" x2="50%" y2="100%">
        <stop offset="0%" stopColor={color} stopOpacity={0.5} />
        <stop offset="100%" stopColor={color} stopOpacity={0} />
      </linearGradient>
    </defs>
  );
}

export default function UploadTrendChart({ data, days, onDaysChange }) {
  const theme = useTheme();

  const colorPalette = [
    theme.palette.primary.light,
    theme.palette.primary.main,
    theme.palette.primary.dark,
  ];

  // 提取日期和数据
  const dates = data.map(item => {
    const date = new Date(item.date);
    return `${date.getMonth() + 1}/${date.getDate()}`;
  });

  const fileCounts = data.map(item => item.fileCount || 0);
  const totalSizes = data.map(item => (item.totalSize || 0) / (1024 * 1024)); // 转换为 MB

  // 计算总上传数和增长率
  const totalFiles = fileCounts.reduce((sum, count) => sum + count, 0);
  const avgFiles = totalFiles / (fileCounts.length || 1);
  const recentAvg = fileCounts.slice(-7).reduce((sum, count) => sum + count, 0) / 7;
  const growthRate = avgFiles > 0 ? ((recentAvg - avgFiles) / avgFiles * 100).toFixed(1) : 0;

  return (
    <Card variant="outlined" sx={{ width: '100%' }}>
      <CardContent>
        <Typography component="h2" variant="subtitle2" gutterBottom>
          上传趋势
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
              {totalFiles}
            </Typography>
            <Chip
              size="small"
              color={growthRate >= 0 ? 'success' : 'error'}
              label={`${growthRate >= 0 ? '+' : ''}${growthRate}%`}
            />
          </Stack>
          <Typography variant="caption" sx={{ color: 'text.secondary' }}>
            最近 {days} 天的上传统计
          </Typography>
        </Stack>

        <Box sx={{ mt: 2, mb: 1 }}>
          <Tabs value={days} onChange={(e, v) => onDaysChange(v)}>
            <Tab label="7天" value={7} />
            <Tab label="30天" value={30} />
            <Tab label="90天" value={90} />
          </Tabs>
        </Box>

        <LineChart
          colors={colorPalette}
          xAxis={[
            {
              scaleType: 'point',
              data: dates,
              tickInterval: (index, i) => (i + 1) % Math.ceil(dates.length / 7) === 0,
              height: 24,
            },
          ]}
          yAxis={[
            { id: 'fileCount', width: 50 },
            { id: 'totalSize', width: 50 },
          ]}
          series={[
            {
              id: 'fileCount',
              label: '文件数',
              yAxisId: 'fileCount',
              showMark: false,
              curve: 'linear',
              area: true,
              data: fileCounts,
            },
            {
              id: 'totalSize',
              label: '存储大小 (MB)',
              yAxisId: 'totalSize',
              showMark: false,
              curve: 'linear',
              data: totalSizes,
            },
          ]}
          height={250}
          margin={{ left: 0, right: 20, top: 20, bottom: 0 }}
          grid={{ horizontal: true }}
          sx={{
            '& .MuiAreaElement-series-fileCount': {
              fill: "url('#fileCount')",
            },
          }}
        >
          <AreaGradient color={theme.palette.primary.main} id="fileCount" />
        </LineChart>
      </CardContent>
    </Card>
  );
}
