import { useState } from 'react';
import { Paper, Alert } from '@mui/material';
import { DataGrid } from '@mui/x-data-grid';
import { BORDER_RADIUS } from '../../utils/constants';

/**
 * 通用 DataGrid 封装组件
 *
 * 基于 MUI DataGrid，提供简化配置和合理默认值：
 * - 支持受控/非受控分页模式
 * - 内置加载和错误状态处理
 * - 默认中文国际化
 * - 预设样式（行高自适应、悬停效果）
 *
 * @example
 * // 非受控模式（简单场景）
 * <GenericDataGrid
 *   rows={rows}
 *   columns={columns}
 *   loading={loading}
 * />
 *
 * @example
 * // 受控模式（复杂场景）
 * <GenericDataGrid
 *   rows={rows}
 *   columns={columns}
 *   loading={loading}
 *   pagination={{
 *     controlled: true,
 *     page: paginationModel.page,
 *     pageSize: paginationModel.pageSize,
 *     onPageChange: (page) => setPaginationModel(prev => ({ ...prev, page })),
 *     onPageSizeChange: (pageSize) => setPaginationModel(prev => ({ ...prev, pageSize }))
 *   }}
 * />
 */
export default function GenericDataGrid({
  rows,
  columns,
  pagination = {},
  loading = false,
  error = null,
  localeText = {},
  variant = 'outlined',
  autoHeight = false,
  getRowHeight = () => 'auto',
  density = 'standard',
  disableRowSelectionOnClick = true,
  disableColumnMenu = true,
  checkboxSelection = false,
  onRowSelectionModelChange,
  // 文件管理场景扩展
  onRowClick,
  onCellClick,
  getRowClassName,
  sortModel,
  onSortModelChange,
  sortingMode,
  sx = {},
  rowSx = {},
}) {
  // 非受控分页状态
  const [internalPaginationModel, setInternalPaginationModel] = useState({
    page: pagination.page || 0,
    pageSize: pagination.pageSize || 10,
  });

  // 判断是否受控模式
  const isControlled = pagination.controlled === true;
  const paginationEnabled = pagination.enabled !== false;

  // 当前分页模型
  const currentPaginationModel = isControlled
    ? { page: pagination.page || 0, pageSize: pagination.pageSize || 10 }
    : internalPaginationModel;

  // 分页变更处理
  const handlePaginationChange = (newModel) => {
    if (isControlled) {
      // 受控模式：调用外部回调
      if (newModel.page !== currentPaginationModel.page) {
        pagination.onPageChange?.(newModel.page);
      }
      if (newModel.pageSize !== currentPaginationModel.pageSize) {
        pagination.onPageSizeChange?.(newModel.pageSize);
      }
    } else {
      // 非受控模式：更新内部状态
      setInternalPaginationModel(newModel);
    }
  };

  // 默认国际化文案
  const defaultLocaleText = {
    noRowsLabel: '暂无数据',
    MuiTablePagination: {
      labelRowsPerPage: '每页行数',
      labelDisplayedRows: ({ from, to, count }) =>
        `${from}-${to} / 共 ${count !== -1 ? count : `超过 ${to}`}`,
    },
    ...localeText,
  };

  // 错误状态
  if (error) {
    return (
      <Paper variant={variant} sx={{ p: 3, borderRadius: BORDER_RADIUS.md }}>
        <Alert severity="error">{error}</Alert>
      </Paper>
    );
  }

  return (
    <Paper
      variant={variant}
      sx={{
        flexGrow: 1,
        height: '100%',
        overflow: 'hidden',
        borderRadius: BORDER_RADIUS.md,
        display: 'flex',
        flexDirection: 'column',
        ...sx,
      }}
    >
      <DataGrid
        rows={rows}
        columns={columns}
        loading={loading}
        paginationModel={paginationEnabled ? currentPaginationModel : undefined}
        onPaginationModelChange={paginationEnabled ? handlePaginationChange : undefined}
        pageSizeOptions={pagination.pageSizeOptions || [5, 10, 20, 50]}
        disableRowSelectionOnClick={disableRowSelectionOnClick}
        disableColumnMenu={disableColumnMenu}
        checkboxSelection={checkboxSelection}
        onRowSelectionModelChange={onRowSelectionModelChange}
        getRowHeight={getRowHeight}
        density={density}
        autoHeight={autoHeight}
        onRowClick={onRowClick}
        onCellClick={onCellClick}
        getRowClassName={getRowClassName}
        sortModel={sortModel}
        onSortModelChange={onSortModelChange}
        sortingMode={sortingMode}
        sx={{
          border: 0,
          flexGrow: 1,
          '& .MuiDataGrid-cell': {
            py: 1.5,
          },
          '& .MuiDataGrid-row:hover': {
            backgroundColor: 'action.hover',
          },
          '& .MuiDataGrid-footer': {
            display: 'none',
          },
          ...rowSx,
        }}
        localeText={defaultLocaleText}
      />
    </Paper>
  );
}
