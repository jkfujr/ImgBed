import { DataGrid } from '@mui/x-data-grid';
import Chip from '@mui/material/Chip';
import LinearProgress from '@mui/material/LinearProgress';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import { fmtSize } from '../../../utils/formatters';
import { BORDER_RADIUS } from '../../../utils/constants';

function getUsageLevel(usedBytes, quotaLimitGB) {
  if (!quotaLimitGB) return { level: 'normal', color: 'success', percent: 0 };

  const percent = (usedBytes / (quotaLimitGB * 1024 ** 3)) * 100;

  if (percent >= 90) {
    return { level: 'danger', color: 'error', percent };
  } else if (percent >= 80) {
    return { level: 'warning', color: 'warning', percent };
  } else {
    return { level: 'normal', color: 'success', percent };
  }
}

function UsageProgressBar({ usedBytes, quotaLimitGB }) {
  const usage = getUsageLevel(usedBytes, quotaLimitGB);

  return (
    <Box sx={{ width: '100%' }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.5 }}>
        <Typography variant="body2" sx={{ minWidth: 50 }}>
          {usage.percent.toFixed(1)}%
        </Typography>
        <LinearProgress
          variant="determinate"
          value={Math.min(usage.percent, 100)}
          color={usage.color}
          sx={{ flexGrow: 1, height: 8, borderRadius: BORDER_RADIUS.sm }}
        />
      </Box>
      <Typography variant="caption" sx={{ color: 'text.secondary' }}>
        {fmtSize(usedBytes)} / {quotaLimitGB ? `${quotaLimitGB} GB` : '无限制'}
      </Typography>
    </Box>
  );
}

export default function StorageDataGrid({ storages, quotaStats }) {
  const columns = [
    {
      field: 'name',
      headerName: '渠道名称',
      flex: 1,
      minWidth: 150,
    },
    {
      field: 'type',
      headerName: '类型',
      width: 120,
      renderCell: (params) => (
        <Chip label={params.value} size="small" variant="outlined" />
      ),
    },
    {
      field: 'usage',
      headerName: '容量使用',
      flex: 2,
      minWidth: 250,
      renderCell: (params) => {
        const usedBytes = quotaStats[params.row.id] || 0;
        return (
          <UsageProgressBar
            usedBytes={usedBytes}
            quotaLimitGB={params.row.quota_limit_gb}
          />
        );
      },
    },
    {
      field: 'enabled',
      headerName: '启用状态',
      width: 100,
      renderCell: (params) => (
        <Chip
          label={params.value ? '已启用' : '已禁用'}
          size="small"
          color={params.value ? 'success' : 'default'}
        />
      ),
    },
    {
      field: 'allow_upload',
      headerName: '允许上传',
      width: 100,
      renderCell: (params) => (
        <Chip
          label={params.value ? '允许' : '禁止'}
          size="small"
          color={params.value ? 'primary' : 'default'}
        />
      ),
    },
  ];

  const rows = storages.map(storage => ({
    id: storage.id,
    name: storage.name,
    type: storage.type,
    enabled: storage.enabled,
    allow_upload: storage.allow_upload,
    quota_limit_gb: storage.quota_limit_gb,
  }));

  return (
    <DataGrid
      rows={rows}
      columns={columns}
      getRowClassName={(params) =>
        params.indexRelativeToCurrentPage % 2 === 0 ? 'even' : 'odd'
      }
      initialState={{
        pagination: { paginationModel: { pageSize: 10 } },
      }}
      pageSizeOptions={[5, 10, 20]}
      disableColumnResize
      density="compact"
      autoHeight
      sx={{
        '& .even': {
          backgroundColor: 'action.hover',
        },
      }}
    />
  );
}
