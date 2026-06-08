import { DataGrid } from '@mui/x-data-grid';
import Chip from '@mui/material/Chip';
import StorageUsageProgress from '../../common/StorageUsageProgress';
import { buildStorageUsageDisplay } from '../../common/storageUsage.js';

export default function StorageDataGrid({ storages, quotaStats = {} }) {
  const getUsedBytes = (row) => quotaStats[row.id] ?? row.usedBytes ?? 0;
  const isQuotaStopped = (row) => buildStorageUsageDisplay({
    usedBytes: getUsedBytes(row),
    quotaLimitGB: row.quotaLimitGB,
    disableThresholdPercent: row.disableThresholdPercent,
  }).thresholdReached;

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
        return (
          <StorageUsageProgress
            usedBytes={getUsedBytes(params.row)}
            quotaLimitGB={params.row.quotaLimitGB}
            disableThresholdPercent={params.row.disableThresholdPercent}
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
      field: 'allowUpload',
      headerName: '允许上传',
      width: 100,
      renderCell: (params) => {
        const quotaStopped = isQuotaStopped(params.row);
        return (
          <Chip
            label={quotaStopped ? '容量停用' : (params.value ? '允许' : '禁止')}
            size="small"
            color={quotaStopped ? 'error' : (params.value ? 'primary' : 'default')}
          />
        );
      },
    },
  ];

  const rows = storages.map(storage => ({
    id: storage.id,
    name: storage.name,
    type: storage.type,
    enabled: storage.enabled,
    allowUpload: storage.allowUpload,
    quotaLimitGB: storage.quotaLimitGB,
    disableThresholdPercent: storage.disableThresholdPercent,
    usedBytes: storage.usedBytes,
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
