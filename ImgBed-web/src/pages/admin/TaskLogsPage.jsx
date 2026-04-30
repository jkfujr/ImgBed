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
  IconButton,
  LinearProgress,
  Pagination,
  Stack,
  Tab,
  Tabs,
  Tooltip,
  Typography,
} from '@mui/material';
import RefreshIcon from '@mui/icons-material/Refresh';
import DeleteSweepIcon from '@mui/icons-material/DeleteSweep';
import PauseCircleIcon from '@mui/icons-material/PauseCircle';
import CancelIcon from '@mui/icons-material/Cancel';
import ReplayIcon from '@mui/icons-material/Replay';
import PlayCircleIcon from '@mui/icons-material/PlayCircle';
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
  paused: '已暂停',
  cancelled: '已取消',
};

const STATUS_COLORS = {
  pending: 'default',
  running: 'primary',
  completed: 'success',
  failed: 'error',
  partial_failed: 'warning',
  paused: 'warning',
  cancelled: 'default',
};

const ITEM_STATUS_LABELS = {
  running: '运行中',
  retrying: '重试中',
  success: '成功',
  failed: '失败',
  skipped: '跳过',
  paused: '已暂停',
  cancelled: '已取消',
};

const TASK_TYPE_LABELS = {
  channel_migration: '渠道迁移',
  storage_delete_files: '渠道文件处理',
};

const TRIGGER_TYPE_LABELS = {
  manual: '手动',
  automatic: '自动',
};

const CONTROLLABLE_STATUSES = new Set(['pending', 'running']);
const RESUMABLE_STATUSES = new Set(['paused']);
const CANCELLABLE_STATUSES = new Set(['pending', 'running', 'paused']);
const RETRYABLE_STATUSES = new Set(['failed', 'partial_failed', 'cancelled']);
const CHANNEL_MIGRATION_TASK_TYPE = 'channel_migration';
const STORAGE_DELETE_FILES_TASK_TYPE = 'storage_delete_files';
const DETAIL_PAGE_SIZE = 200;

function createEmptyDetailItems(pageSize = DETAIL_PAGE_SIZE) {
  return {
    loading: false,
    list: [],
    pagination: {
      page: 1,
      pageSize,
      total: 0,
      totalPages: 0,
    },
  };
}

function createEmptyDetailState() {
  return {
    open: false,
    loading: false,
    task: null,
    error: null,
    items: createEmptyDetailItems(),
    failedItems: createEmptyDetailItems(),
  };
}

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
  const [detail, setDetail] = useState(createEmptyDetailState);
  const [detailTab, setDetailTab] = useState('overview');

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

  const loadDetailItems = useCallback(async (taskId, {
    target = 'items',
    itemStatus = '',
    page = 1,
    pageSize = DETAIL_PAGE_SIZE,
  } = {}) => {
    setDetail((prev) => ({
      ...prev,
      [target]: {
        ...prev[target],
        loading: true,
        pagination: {
          ...prev[target].pagination,
          page,
          pageSize,
        },
      },
    }));

    try {
      const res = await TaskLogDocs.detail(taskId, {
        item_status: itemStatus || undefined,
        page,
        pageSize,
      });
      if (res.code === 0) {
        setDetail((prev) => ({
          ...prev,
          error: null,
          task: res.data.task || prev.task,
          [target]: {
            loading: false,
            list: res.data.items || [],
            pagination: {
              page: res.data.pagination?.page || page,
              pageSize: res.data.pagination?.pageSize || pageSize,
              total: res.data.pagination?.total || 0,
              totalPages: res.data.pagination?.totalPages || 0,
            },
          },
        }));
      } else {
        setDetail((prev) => ({
          ...prev,
          error: res.message || '加载失败',
          [target]: {
            ...prev[target],
            loading: false,
          },
        }));
      }
    } catch (err) {
      setDetail((prev) => ({
        ...prev,
        error: err.response?.data?.message || err.message || '网络错误',
        [target]: {
          ...prev[target],
          loading: false,
        },
      }));
    }
  }, []);

  const openDetail = useCallback(async (taskId) => {
    setDetailTab('overview');
    setDetail({
      ...createEmptyDetailState(),
      open: true,
      loading: true,
    });

    try {
      const res = await TaskLogDocs.detail(taskId, { page: 1, pageSize: DETAIL_PAGE_SIZE });
      if (res.code === 0) {
        setDetail((prev) => ({
          ...prev,
          loading: false,
          error: null,
          task: res.data.task || null,
          items: {
            loading: false,
            list: res.data.items || [],
            pagination: {
              page: res.data.pagination?.page || 1,
              pageSize: res.data.pagination?.pageSize || DETAIL_PAGE_SIZE,
              total: res.data.pagination?.total || 0,
              totalPages: res.data.pagination?.totalPages || 0,
            },
          },
        }));
      } else {
        setDetail((prev) => ({
          ...prev,
          loading: false,
          error: res.message || '加载失败',
        }));
      }
    } catch (err) {
      setDetail((prev) => ({
        ...prev,
        loading: false,
        error: err.response?.data?.message || err.message || '网络错误',
      }));
    }
  }, []);

  const closeDetail = () => setDetail(createEmptyDetailState());

  const runTaskAction = useCallback(async (row, action) => {
    setLoading(true);
    setError(null);
    try {
      await TaskLogDocs[action](row.id);
      await loadTasks();
      if (detail.open && detail.task?.id === row.id) {
        await openDetail(row.id);
      }
    } catch (err) {
      setError(err.response?.data?.message || err.message || '任务操作失败');
      setLoading(false);
    }
  }, [detail.open, detail.task?.id, loadTasks, openDetail]);

  const handleDetailTabChange = useCallback((_event, value) => {
    setDetailTab(value);
    if (!detail.task?.id) {
      return;
    }

    if (value === 'items' && detail.items.list.length === 0 && detail.items.pagination.total === 0) {
      void loadDetailItems(detail.task.id, { target: 'items' });
    }
    if (value === 'failed' && detail.failedItems.list.length === 0 && detail.failedItems.pagination.total === 0) {
      void loadDetailItems(detail.task.id, {
        target: 'failedItems',
        itemStatus: 'failed',
      });
    }
  }, [
    detail.failedItems.list.length,
    detail.failedItems.pagination.total,
    detail.items.list.length,
    detail.items.pagination.total,
    detail.task?.id,
    loadDetailItems,
  ]);

  const handleDetailPageChange = useCallback((target, itemStatus) => (_event, page) => {
    if (!detail.task?.id) {
      return;
    }
    void loadDetailItems(detail.task.id, {
      target,
      itemStatus,
      page,
      pageSize: detail[target].pagination.pageSize,
    });
  }, [detail, loadDetailItems]);

  const renderTaskItems = (items, emptyText) => {
    const list = items || [];
    if (list.length === 0) {
      return <Typography variant="body2" color="text.secondary">{emptyText}</Typography>;
    }

    return list.map((item) => (
      <Box key={item.id} sx={{ py: 1, borderBottom: 1, borderColor: 'divider' }}>
        <Typography variant="body2" sx={{ overflowWrap: 'anywhere' }}>
          {item.file_id || '-'} · {ITEM_STATUS_LABELS[item.status] || item.status} · 尝试 {item.attempt_count} 次
        </Typography>
        <Typography variant="caption" color="text.secondary">
          更新时间：{formatDate(item.updated_at)}
        </Typography>
        {item.last_error && (
          <Typography variant="caption" color="error" display="block" sx={{ overflowWrap: 'anywhere' }}>
            {item.last_error}
          </Typography>
        )}
      </Box>
    ));
  };

  const renderTaskItemsPanel = ({
    state,
    emptyText,
    target,
    itemStatus = '',
  }) => (
    <Stack spacing={1}>
      {state.loading && <LinearProgress />}
      {!state.loading && renderTaskItems(state.list, emptyText)}
      {state.pagination.totalPages > 1 && (
        <Stack direction="row" justifyContent="flex-end">
          <Pagination
            size="small"
            page={state.pagination.page}
            count={state.pagination.totalPages}
            onChange={handleDetailPageChange(target, itemStatus)}
          />
        </Stack>
      )}
    </Stack>
  );

  const renderTaskActionButtons = useCallback((row) => {
    const isChannelMigration = row.task_type === CHANNEL_MIGRATION_TASK_TYPE;
    const isStorageDeleteFiles = row.task_type === STORAGE_DELETE_FILES_TASK_TYPE;

    return (
      <Stack direction="row" spacing={0.5} alignItems="center">
        {isChannelMigration && CONTROLLABLE_STATUSES.has(row.status) && (
          <Tooltip title="暂停任务">
            <span>
              <IconButton
                size="small"
                color="warning"
                disabled={loading}
                onClick={() => runTaskAction(row, 'pause')}
              >
                <PauseCircleIcon fontSize="small" />
              </IconButton>
            </span>
          </Tooltip>
        )}
        {isChannelMigration && RESUMABLE_STATUSES.has(row.status) && (
          <Tooltip title="继续任务">
            <span>
              <IconButton
                size="small"
                color="success"
                disabled={loading}
                onClick={() => runTaskAction(row, 'resume')}
              >
                <PlayCircleIcon fontSize="small" />
              </IconButton>
            </span>
          </Tooltip>
        )}
        {((isChannelMigration && CANCELLABLE_STATUSES.has(row.status))
          || (isStorageDeleteFiles && CONTROLLABLE_STATUSES.has(row.status))) && (
          <Tooltip title="取消任务">
            <span>
              <IconButton
                size="small"
                color="error"
                disabled={loading}
                onClick={() => runTaskAction(row, 'cancel')}
              >
                <CancelIcon fontSize="small" />
              </IconButton>
            </span>
          </Tooltip>
        )}
        {isChannelMigration && RETRYABLE_STATUSES.has(row.status) && (
          <Tooltip title="重试任务">
            <span>
              <IconButton
                size="small"
                color="primary"
                disabled={loading}
                onClick={() => runTaskAction(row, 'retry')}
              >
                <ReplayIcon fontSize="small" />
              </IconButton>
            </span>
          </Tooltip>
        )}
      </Stack>
    );
  }, [loading, runTaskAction]);

  const columns = useMemo(() => [
    {
      field: 'task_type',
      headerName: '任务类型',
      width: 150,
      valueGetter: (value) => TASK_TYPE_LABELS[value] || value,
    },
    {
      field: 'trigger_type',
      headerName: '来源',
      width: 100,
      valueGetter: (value) => TRIGGER_TYPE_LABELS[value] || value || '-',
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
      width: 220,
      sortable: false,
      renderCell: (params) => (
        <Stack direction="row" spacing={0.5} alignItems="center">
          <Tooltip title="查看详情">
            <IconButton size="small" onClick={() => openDetail(params.row.id)}>
              <VisibilityIcon fontSize="small" />
            </IconButton>
          </Tooltip>
          {renderTaskActionButtons(params.row)}
        </Stack>
      ),
    },
  ], [openDetail, renderTaskActionButtons]);

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
          {detail.error && <Alert severity="error">{detail.error}</Alert>}
          {detail.task && (
            <Stack spacing={1}>
              <Tabs value={detailTab} onChange={handleDetailTabChange}>
                <Tab label="概览" value="overview" />
                <Tab label="任务日志" value="items" />
                <Tab label="失败项" value="failed" />
              </Tabs>

              {detailTab === 'overview' && (
                <Stack spacing={1}>
                  <Typography variant="body2">任务 ID：{detail.task.id}</Typography>
                  <Typography variant="body2">任务类型：{TASK_TYPE_LABELS[detail.task.task_type] || detail.task.task_type}</Typography>
                  <Typography variant="body2">来源：{TRIGGER_TYPE_LABELS[detail.task.trigger_type] || detail.task.trigger_type || '-'}</Typography>
                  <Typography variant="body2">状态：{STATUS_LABELS[detail.task.status] || detail.task.status}</Typography>
                  <Typography variant="body2">进度：{progressValue(detail.task).toFixed(0)}%</Typography>
                  <Typography variant="body2">
                    成功 {detail.task.success_count} / 失败 {detail.task.failed_count} / 跳过 {detail.task.skipped_count} / 总数 {detail.task.total_count}
                  </Typography>
                  <Typography variant="body2">源 / 目标：{detail.task.source_storage_id || '-'} -&gt; {detail.task.target_storage_id || '-'}</Typography>
                  <Typography variant="body2">创建时间：{formatDate(detail.task.created_at)}</Typography>
                  <Typography variant="body2">开始时间：{formatDate(detail.task.started_at)}</Typography>
                  <Typography variant="body2">结束时间：{formatDate(detail.task.ended_at)}</Typography>
                </Stack>
              )}

              {detailTab === 'items' && renderTaskItemsPanel({
                state: detail.items,
                emptyText: '暂无任务日志',
                target: 'items',
              })}

              {detailTab === 'failed' && renderTaskItemsPanel({
                state: detail.failedItems,
                emptyText: '暂无失败项',
                target: 'failedItems',
                itemStatus: 'failed',
              })}
            </Stack>
          )}
        </DialogContent>
        <DialogActions>
          {detail.task && renderTaskActionButtons(detail.task)}
          <Button onClick={closeDetail}>关闭</Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
