import Box from '@mui/material/Box';
import LinearProgress from '@mui/material/LinearProgress';
import Typography from '@mui/material/Typography';
import { BORDER_RADIUS } from '../../utils/constants';
import { buildStorageUsageDisplay } from './storageUsage.js';

export default function StorageUsageProgress({ usedBytes, quotaLimitGB, disableThresholdPercent }) {
  const usage = buildStorageUsageDisplay({
    usedBytes,
    quotaLimitGB,
    disableThresholdPercent,
  });

  return (
    <Box sx={{ width: '100%', minWidth: 180 }}>
      {usage.limited && (
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <Typography variant="body2" sx={{ minWidth: 45 }}>
            {usage.percent.toFixed(1)}%
          </Typography>
          <LinearProgress
            variant="determinate"
            value={Math.min(usage.percent, 100)}
            color={usage.color}
            sx={{ flexGrow: 1, height: 6, borderRadius: BORDER_RADIUS.sm }}
          />
        </Box>
      )}
      <Typography variant="caption" color="text.secondary">
        {usage.text}
      </Typography>
    </Box>
  );
}
