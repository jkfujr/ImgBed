import * as React from 'react';
import { PieChart } from '@mui/x-charts/PieChart';
import { useDrawingArea } from '@mui/x-charts/hooks';
import { styled } from '@mui/material/styles';
import Typography from '@mui/material/Typography';
import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import Box from '@mui/material/Box';
import Stack from '@mui/material/Stack';
import LinearProgress, { linearProgressClasses } from '@mui/material/LinearProgress';
import { BORDER_RADIUS } from '../../../utils/constants';

const StyledText = styled('text', {
  shouldForwardProp: (prop) => prop !== 'variant',
})(({ theme }) => ({
  textAnchor: 'middle',
  dominantBaseline: 'central',
  fill: (theme.vars || theme).palette.text.secondary,
  variants: [
    {
      props: {
        variant: 'primary',
      },
      style: {
        fontSize: theme.typography.h5.fontSize,
      },
    },
    {
      props: ({ variant }) => variant !== 'primary',
      style: {
        fontSize: theme.typography.body2.fontSize,
      },
    },
    {
      props: {
        variant: 'primary',
      },
      style: {
        fontWeight: theme.typography.h5.fontWeight,
      },
    },
    {
      props: ({ variant }) => variant !== 'primary',
      style: {
        fontWeight: theme.typography.body2.fontWeight,
      },
    },
  ],
}));

function PieCenterLabel({ primaryText, secondaryText }) {
  const { width, height, left, top } = useDrawingArea();
  const primaryY = top + height / 2 - 10;
  const secondaryY = primaryY + 24;

  return (
    <React.Fragment>
      <StyledText variant="primary" x={left + width / 2} y={primaryY}>
        {primaryText}
      </StyledText>
      <StyledText variant="secondary" x={left + width / 2} y={secondaryY}>
        {secondaryText}
      </StyledText>
    </React.Fragment>
  );
}

const colors = [
  'hsl(220, 20%, 65%)',
  'hsl(220, 20%, 42%)',
];

export default function CacheStatsCard({ data }) {
  if (!data || !data.enabled) {
    return (
      <Card
        variant="outlined"
        sx={{ display: 'flex', flexDirection: 'column', gap: '8px', flexGrow: 1 }}
      >
        <CardContent>
          <Typography component="h2" variant="subtitle2">
            缓存统计
          </Typography>
          <Typography variant="body2" sx={{ color: 'text.secondary', mt: 2 }}>
            缓存未启用
          </Typography>
        </CardContent>
      </Card>
    );
  }

  const hitRate = Number(data.hitRate) || 0;
  const hits = Number(data.hits) || 0;
  const misses = Number(data.misses) || 0;
  const currentKeys = Number(data.currentKeys) || 0;
  const maxKeys = Number(data.maxKeys) || 0;

  const pieData = [
    { label: '命中', value: hits },
    { label: '未命中', value: misses },
  ];

  const stats = [
    {
      name: '缓存命中',
      value: hits,
      color: 'hsl(220, 20%, 65%)',
    },
    {
      name: '缓存未命中',
      value: misses,
      color: 'hsl(220, 20%, 42%)',
    },
  ];

  return (
    <Card
      variant="outlined"
      sx={{ display: 'flex', flexDirection: 'column', gap: '8px', flexGrow: 1 }}
    >
      <CardContent>
        <Typography component="h2" variant="subtitle2">
          缓存统计
        </Typography>
        <Box sx={{ display: 'flex', alignItems: 'center' }}>
          <PieChart
            colors={colors}
            margin={{
              left: 80,
              right: 80,
              top: 80,
              bottom: 80,
            }}
            series={[
              {
                data: pieData,
                innerRadius: 75,
                outerRadius: 100,
                paddingAngle: 0,
                highlightScope: { fade: 'global', highlight: 'item' },
              },
            ]}
            height={260}
            width={260}
            hideLegend
          >
            <PieCenterLabel primaryText={`${hitRate.toFixed(1)}%`} secondaryText="命中率" />
          </PieChart>
        </Box>
        {stats.map((stat, index) => (
          <Stack
            key={index}
            direction="row"
            sx={{ alignItems: 'center', gap: 2, pb: 2 }}
          >
            <Box
              sx={{
                width: 12,
                height: 12,
                borderRadius: BORDER_RADIUS.circle,
                backgroundColor: stat.color,
              }}
            />
            <Stack sx={{ gap: 1, flexGrow: 1 }}>
              <Stack
                direction="row"
                sx={{
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  gap: 2,
                }}
              >
                <Typography variant="body2" sx={{ fontWeight: '500' }}>
                  {stat.name}
                </Typography>
                <Typography variant="body2" sx={{ color: 'text.secondary' }}>
                  {stat.value.toLocaleString()}
                </Typography>
              </Stack>
            </Stack>
          </Stack>
        ))}
        <Box sx={{ mt: 2, pt: 2, borderTop: 1, borderColor: 'divider' }}>
          <Stack direction="row" justifyContent="space-between" sx={{ mb: 1 }}>
            <Typography variant="body2">缓存键数</Typography>
            <Typography variant="body2" sx={{ color: 'text.secondary' }}>
              {currentKeys} / {maxKeys}
            </Typography>
          </Stack>
          <LinearProgress
            variant="determinate"
            value={(currentKeys / maxKeys) * 100}
            sx={{
              height: 6,
              borderRadius: BORDER_RADIUS.sm,
            }}
          />
        </Box>
      </CardContent>
    </Card>
  );
}
