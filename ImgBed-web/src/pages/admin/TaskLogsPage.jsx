import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  LinearProgress,
  Stack,
  Typography,
} from '@mui/material';
import RefreshIcon from '@mui/icons-material/Refresh';
import DeleteSweepIcon from '@mui/icons-material/DeleteSweep';
import VisibilityIcon from '@mui/icons-material/Visibility';
import GenericToolbar from '../../components/common/GenericToolbar';
import GenericDataGrid from '../../components/common/GenericDataGrid';
import LoadingSpinner from '../../components/common/LoadingSpinner';
import { TaskLogDocs } from '../../api';

const STATUS_LABELS = {
  pending: '等待中',
  running: '运行中',
  completed: '已完成',
  failed: '失败',
  partial_failed: '部分失败',
};

const STATUS_COLORS = {
  pending: 'default',
  running: 'primary',
  completed: 'success',
  failed: 'error',
  partial_failed: 'warning',
};

const ITEM_STATUS_LABELS = {
  running: '运行中',
  retrying: '重试中',
  success: '成功',
  failed: '失败',
  skipped: '跳过',
};

function formatDate(value) {
  if (!value) return '-';
  return new Date(value).toLocaleString();
}

function progressValue(row) {
  const total = Number(row.total_count) || 0;
  if (total <= 0) return 0;
  return Math.min(100, ((Number(row.success_count) + Number(row.failed_count) + Number(row.skipped_count)) / total) * 100);
}

export default function TaskLogsPage() {
  const [rows, setRows] = useState([]);
  const [pagination, setPagination] = useState({ page: 1, pageSize: 20, total: 0 });
  const [statusFilter, setStatusFilter] = useState('all');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [detail, setDetail] = useState({ open: false, loading: false, data: null });

  const loadTasks = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await TaskLogDocs.list({
        page: pagination.page,
        pageSize: pagination.pageSize,
        status: statusFilter === 'all' ? undefined : statusFilter,
      });
      if (res.code === 0) {
        setRows(res.data.list || []);
        setPagination((prev) => ({
          ...prev,
          total: res.data.pagination?.total || 0,
        }));
      } else {
        setError(res.message || '加载失败');
      }
    } catch (err) {
      setError(err.response?.data?.message || err.message || '网络错误');
    } finally {
      setLoading(false);
    }
  }, [pagination.page, pagination.pageSize, statusFilter]);

  useEffect(() => {
    loadTasks();
  }, [loadTasks]);

  const clearTerminalLogs = async () => {
    setLoading(true);
    setError(null);
    try {
      await TaskLogDocs.clearTerminal();
      await loadTasks();
    } catch (err) {
      setError(err.response?.data?.message || err.message || '清理失败');
      setLoading(false);
    }
  };

  const openDetail = async (taskId) => {
    setDetail({ open: true, loading: true, data: null });
    try {
      const res = await TaskLogDocs.detail(taskId, { item_status: 'failed' });
      if (res.code === 0) {
        setDetail({ open: true, loading: false, data: res.data });
      } else {
        setDetail({ open: true, loading: false, data: { error: res.message || '加载失败' } });
      }
    } catch (err) {
      setDetail({ open: true, loading: false, data: { error: err.response?.data?.message || err.message || '网络错误' } });
    }
  };

  const closeDetail = () => setDetail({ open: false, loading: false, data: null });

  const columns = useMemo(() => [
    {
      field: 'task_type',
      headerName: '任务类型',
      width: 150,
      valueGetter: (value) => value === 'channel_migration' ? '渠道迁移' : value,
    },
    {
      field: 'status',
      headerName: '状态',
      width: 120,
      renderCell: (params) => (
        <Chip
          size="small"
          label={STATUS_LABELS[params.value] || params.value}
          color={STATUS_COLORS[params.value] || 'default'}
          variant="outlined"
        />
      ),
    },
    {
      field: 'progress',
      headerName: '进度',
      minWidth: 220,
      flex: 1,
      sortable: false,
      renderCell: (params) => {
        const value = progressValue(params.row);
        return (
          <Box sx={{ width: '100%' }}>
            <Stack direction="row" spacing={1} alignItems="center">
              <Typography variant="body2" sx={{ width: 44 }}>{value.toFixed(0)}%</Typography>
              <LinearProgress variant="determinate" value={value} sx={{ flexGrow: 1, height: 6 }} />
            </Stack>
            <Typography variant="caption" color="text.secondary">
              成功 {params.row.success_count} / 失败 {params.row.failed_count} / 跳过 {params.row.skipped_count} / 总数 {params.row.total_count}
            </Typography>
          </Box>
        );
      },
    },
    {
      field: 'channels',
      headerName: '源 / 目标',
      minWidth: 220,
      flex: 1,
      valueGetter: (_value, row) => `${row.source_storage_id || '-'} -> ${row.target_storage_id || '-'}`,
    },
    {
      field: 'created_at',
      headerName: '创建时间',
      width: 180,
      valueGetter: (value) => formatDate(value),
    },
    {
      field: 'actions',
      headerName: '操作',
      width: 90,
      sortable: false,
      renderCell: (params) => (
        <Button
          size="small"
          startIcon={<VisibilityIcon fontSize="small" />}
          onClick={() => openDetail(params.row.id)}
        >
          查看
        </Button>
      ),
    },
  ], []);

  if (loading && rows.length === 0) {
    return <LoadingSpinner fullHeight={false} />;
  }

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, height: '100%' }}>
      <GenericToolbar
        stats={{
          items: [
            { label: '共', value: pagination.total, bold: true },
          ],
        }}
        filters={[
          {
            type: 'select',
            label: '状态筛选',
            value: statusFilter,
            onChange: (value) => {
              setStatusFilter(value);
              setPagination((prev) => ({ ...prev, page: 1 }));
            },
            options: [
              { value: 'all', label: '全部状态' },
              ...Object.entries(STATUS_LABELS).map(([value, label]) => ({ value, label })),
            ],
            minWidth: 130,
          },
        ]}
        actions={[
          {
            type: 'iconButton',
            icon: <RefreshIcon />,
            tooltip: '刷新任务日志',
            onClick: loadTasks,
            disabled: loading,
          },
          {
            type: 'iconButton',
            icon: <DeleteSweepIcon />,
            tooltip: '清理终态任务日志',
            onClick: clearTerminalLogs,
            disabled: loading,
            color: 'error',
          },
        ]}
        loading={loading}
      />

      {error && <Alert severity="error" onClose={() => setError(null)}>{error}</Alert>}

      <GenericDataGrid
        rows={rows}
        columns={columns}
        loading={loading}
        pagination={{
          controlled: true,
          page: pagination.page - 1,
          pageSize: pagination.pageSize,
          onPageChange: (page) => setPagination((prev) => ({ ...prev, page: page + 1 })),
          onPageSizeChange: (pageSize) => setPagination((prev) => ({ ...prev, page: 1, pageSize })),
        }}
        localeText={{
          noRowsLabel: '暂无任务日志',
        }}
      />

      <Dialog open={detail.open} onClose={closeDetail} maxWidth="md" fullWidth>
        <DialogTitle>任务详情</DialogTitle>
        <DialogContent dividers>
          {detail.loading && <LinearProgress />}
          {detail.data?.error && <Alert severity="error">{detail.data.error}</Alert>}
          {detail.data?.task && (
            <Stack spacing={1}>
              <Typography variant="body2">任务 ID：{detail.data.task.id}</Typography>
              <Typography variant="body2">状态：{STATUS_LABELS[detail.data.task.status] || detail.data.task.status}</Typography>
              <Typography variant="body2">创建时间：{formatDate(detail.data.task.created_at)}</Typography>
              {detail.data.task.error_summary && (
                <Alert severity="warning">{detail.data.task.error_summary}</Alert>
              )}
              <Typography variant="subtitle2" sx={{ mt: 1 }}>失败项</Typography>
              {(detail.data.items || []).length === 0 ? (
                <Typography variant="body2" color="text.secondary">暂无失败项</Typography>
              ) : (
                (detail.data.items || []).map((item) => (
                  <Box key={item.id} sx={{ py: 1, borderBottom: 1, borderColor: 'divider' }}>
                    <Typography variant="body2">
                      {item.file_id} · {ITEM_STATUS_LABELS[item.status] || item.status} · 尝试 {item.attempt_count} 次
                    </Typography>
                    {item.last_error && (
                      <Typography variant="caption" color="error">{item.last_error}</Typography>
                    )}
                  </Box>
                ))
              )}
            </Stack>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={closeDetail}>关闭</Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
