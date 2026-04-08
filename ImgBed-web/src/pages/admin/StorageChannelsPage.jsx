import { useState, useMemo } from 'react';
import {
  Box, IconButton, Tooltip, Chip,
  Stack, Alert, Typography,
} from '@mui/material';
import RefreshIcon from '@mui/icons-material/Refresh';
import EditIcon from '@mui/icons-material/Edit';
import DeleteIcon from '@mui/icons-material/Delete';
import StarIcon from '@mui/icons-material/Star';
import StarBorderIcon from '@mui/icons-material/StarBorder';
import ToggleOnIcon from '@mui/icons-material/ToggleOn';
import ToggleOffIcon from '@mui/icons-material/ToggleOff';
import LinearProgress from '@mui/material/LinearProgress';
import ConfirmDialog from '../../components/common/ConfirmDialog';
import ChannelDialog from '../../components/common/ChannelDialog';
import LoadingSpinner from '../../components/common/LoadingSpinner';
import GenericToolbar from '../../components/common/GenericToolbar';
import GenericDataGrid from '../../components/common/GenericDataGrid';
import { TYPE_COLORS, VALID_TYPES, BORDER_RADIUS } from '../../utils/constants';
import { bytesToGB, calculateQuotaPercent } from '../../utils/formatters';
import { useStorageChannels } from '../../hooks/useStorageChannels';

/** 容量使用进度条组件 */
function UsageProgressBar({ storage, quotaStats }) {
  const quotaLimitGB = storage.quotaLimitGB;
  if (!quotaLimitGB || quotaLimitGB <= 0) {
    return <Typography variant="body2" color="text.secondary">无限制</Typography>;
  }

  const usedBytes = quotaStats[storage.id] || 0;
  const usedGB = bytesToGB(usedBytes);
  const percent = calculateQuotaPercent(usedBytes, quotaLimitGB);
  const thresholdPercent = storage.disableThresholdPercent ?? 95;

  let color = 'primary';
  if (percent >= thresholdPercent) color = 'error';
  else if (percent > 70) color = 'warning';

  return (
    <Box sx={{ width: '100%', minWidth: 180 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
        <Typography variant="body2" sx={{ minWidth: 45 }}>
          {percent.toFixed(1)}%
        </Typography>
        <LinearProgress
          variant="determinate"
          value={Math.min(percent, 100)}
          color={color}
          sx={{ flexGrow: 1, height: 6, borderRadius: BORDER_RADIUS.sm }}
        />
      </Box>
      <Typography variant="caption" color="text.secondary">
        {usedGB.toFixed(2)} GB / {quotaLimitGB} GB
      </Typography>
    </Box>
  );
}

export default function StorageChannelsPage() {
  const {
    storages, defaultId, loading, error, quotaStats, stats,
    dialogOpen, editTarget, deleteTarget, deleting,
    loadStorages, openEdit, closeDialog,
    handleToggle, handleSetDefault, handleDelete,
    setDeleteTarget, clearError, onDialogSuccess,
  } = useStorageChannels();

  const [typeFilter, setTypeFilter] = useState('all');
  const [paginationModel, setPaginationModel] = useState({ page: 0, pageSize: 10 });

  // 筛选逻辑
  const filteredStorages = useMemo(() => {
    let result = storages;

    // 类型筛选
    if (typeFilter !== 'all') {
      result = result.filter(s => s.type === typeFilter);
    }

    return result;
  }, [storages, typeFilter]);

  // DataGrid 列定义
  const columns = [
    {
      field: 'name',
      headerName: '渠道名称',
      flex: 1.5,
      minWidth: 180,
      renderCell: (params) => (
        <Box>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
            <Typography variant="body2" fontWeight="medium" noWrap>
              {params.row.name}
            </Typography>
            {params.row.id === defaultId && (
              <StarIcon fontSize="small" sx={{ color: 'warning.main' }} />
            )}
          </Box>
          <Typography variant="caption" color="text.secondary" noWrap>
            ID: {params.row.id}
          </Typography>
        </Box>
      ),
    },
    {
      field: 'type',
      headerName: '类型',
      width: 120,
      renderCell: (params) => (
        <Chip
          label={params.value}
          size="small"
          color={TYPE_COLORS[params.value] || 'default'}
          variant="outlined"
        />
      ),
    },
    {
      field: 'status',
      headerName: '状态',
      width: 140,
      renderCell: (params) => (
        <Stack direction="row" spacing={0.5}>
          <Chip
            label={params.row.enabled ? '已启用' : '已禁用'}
            size="small"
            color={params.row.enabled ? 'success' : 'default'}
            variant="outlined"
          />
          {params.row.allowUpload && (
            <Chip label="可上传" size="small" color="primary" variant="outlined" />
          )}
        </Stack>
      ),
    },
    {
      field: 'usage',
      headerName: '容量使用',
      flex: 2,
      minWidth: 220,
      sortable: false,
      renderCell: (params) => (
        <UsageProgressBar storage={params.row} quotaStats={quotaStats} />
      ),
    },
    {
      field: 'actions',
      headerName: '操作',
      width: 160,
      sortable: false,
      renderCell: (params) => (
        <Stack direction="row" spacing={0.5}>
          <Tooltip title={params.row.id === defaultId ? '当前默认' : '设为默认'}>
            <span>
              <IconButton
                size="small"
                onClick={() => handleSetDefault(params.row.id)}
                disabled={params.row.id === defaultId}
                color={params.row.id === defaultId ? 'warning' : 'default'}
              >
                {params.row.id === defaultId ? (
                  <StarIcon fontSize="small" />
                ) : (
                  <StarBorderIcon fontSize="small" />
                )}
              </IconButton>
            </span>
          </Tooltip>
          <Tooltip title="编辑">
            <IconButton size="small" onClick={() => openEdit(params.row)}>
              <EditIcon fontSize="small" />
            </IconButton>
          </Tooltip>
          <Tooltip title={params.row.enabled ? '禁用' : '启用'}>
            <IconButton
              size="small"
              onClick={() => handleToggle(params.row)}
              color={params.row.enabled ? 'success' : 'default'}
            >
              {params.row.enabled ? (
                <ToggleOnIcon fontSize="small" />
              ) : (
                <ToggleOffIcon fontSize="small" />
              )}
            </IconButton>
          </Tooltip>
          <Tooltip title={params.row.id === defaultId ? '默认渠道不可删除' : '删除'}>
            <span>
              <IconButton
                size="small"
                color="error"
                disabled={params.row.id === defaultId}
                onClick={() => setDeleteTarget(params.row)}
              >
                <DeleteIcon fontSize="small" />
              </IconButton>
            </span>
          </Tooltip>
        </Stack>
      ),
    },
  ];

  // 转换数据格式
  const rows = filteredStorages.map(s => ({
    id: s.id,
    name: s.name,
    type: s.type,
    enabled: s.enabled,
    allowUpload: s.allowUpload,
    quotaLimitGB: s.quotaLimitGB,
    disableThresholdPercent: s.disableThresholdPercent,
  }));

  if (loading && storages.length === 0) {
    return <LoadingSpinner fullHeight={false} />;
  }

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, height: '100%' }}>
      {/* 工具栏 */}
      <GenericToolbar
        stats={stats ? {
          items: [
            { label: '共', value: stats.total, bold: true },
            { label: '已启用', value: stats.enabled, color: 'success.main', bold: true },
            { label: '可上传', value: stats.allowUpload, color: 'primary.main', bold: true },
          ],
          separator: ' · ',
        } : undefined}
        filters={[
          {
            type: 'select',
            label: '类型筛选',
            value: typeFilter,
            onChange: setTypeFilter,
            options: [
              { value: 'all', label: '全部类型' },
              ...VALID_TYPES.map(type => ({ value: type, label: type })),
            ],
            minWidth: 120,
          },
        ]}
        actions={[
          {
            type: 'iconButton',
            icon: <RefreshIcon />,
            tooltip: '刷新列表',
            onClick: loadStorages,
            disabled: loading,
          },
        ]}
        loading={loading}
      />

      {/* 错误提示 */}
      {error && (
        <Alert severity="error" onClose={clearError}>
          {error}
        </Alert>
      )}

      {/* 数据表格 */}
      <GenericDataGrid
        rows={rows}
        columns={columns}
        loading={loading}
        pagination={{
          controlled: true,
          page: paginationModel.page,
          pageSize: paginationModel.pageSize,
          onPageChange: (page) => setPaginationModel(prev => ({ ...prev, page })),
          onPageSizeChange: (pageSize) => setPaginationModel(prev => ({ ...prev, pageSize })),
        }}
        localeText={{
          noRowsLabel: '暂无存储渠道',
        }}
      />

      {/* 编辑对话框 */}
      <ChannelDialog
        open={dialogOpen}
        onClose={closeDialog}
        editTarget={editTarget}
        onSuccess={onDialogSuccess}
      />

      {/* 删除确认对话框 */}
      <ConfirmDialog
        open={Boolean(deleteTarget)}
        title="确认删除"
        onClose={() => setDeleteTarget(null)}
        onConfirm={handleDelete}
        confirmLoading={deleting}
        confirmText="确认删除"
      >
        确定要删除渠道「{deleteTarget?.name}」（{deleteTarget?.id}）吗？此操作不可撤销。
      </ConfirmDialog>
    </Box>
  );
}
