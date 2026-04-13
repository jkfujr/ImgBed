import { Box, Checkbox, Chip, IconButton, Tooltip, Typography } from '@mui/material';
import { useEffect, useMemo, useCallback } from 'react';
import DeleteIcon from '@mui/icons-material/Delete';
import InfoIcon from '@mui/icons-material/Info';
import FolderIcon from '@mui/icons-material/Folder';
import { BORDER_RADIUS } from '../../utils/constants';
import { fmtDate, fmtSize, parseChannelName, channelTypeLabel, parseTags } from '../../utils/formatters';
import imageCacheManager from '../../utils/imageCache';
import GenericDataGrid from '../common/GenericDataGrid';

export default function FilesAdminListView({
  directories,
  data,
  selected,
  onToggleSelect,
  onSelectAll,
  onClearSelection,
  onNavigateToDir,
  onOpenDetail,
  onTriggerDelete,
}) {
  // 批量标记图片已加载
  useEffect(() => {
    if (data.length > 0) {
      const imageIds = data.map(item => item.id);
      imageCacheManager.markBatchAsLoaded(imageIds);
    }
  }, [data]);

  // 合并目录和文件数据
  const rows = useMemo(() => {
    const dirRows = directories.map(dir => ({
      id: `dir-${dir.path}`,
      _type: 'directory',
      name: dir.name,
      path: dir.path,
    }));

    const fileRows = data.map(item => ({
      id: item.id,
      _type: 'file',
      ...item,
    }));

    return [...dirRows, ...fileRows];
  }, [directories, data]);

  // 行点击：目录行导航
  const handleRowClick = useCallback((params) => {
    if (params.row._type === 'directory') {
      onNavigateToDir(params.row.path);
    }
  }, [onNavigateToDir]);

  // 自定义行样式：目录行 pointer
  const getRowClassName = useCallback((params) => {
    return params.row._type === 'directory' ? 'directory-row' : '';
  }, []);

  // 全选状态
  const allSelected = data.length > 0 && selected.size === data.length;
  const indeterminate = selected.size > 0 && selected.size < data.length;

  // 列定义
  const columns = [
    {
      field: 'select',
      headerName: '',
      width: 60,
      sortable: false,
      renderHeader: () => (
        <Checkbox
          size="small"
          indeterminate={indeterminate}
          checked={allSelected}
          onChange={() => {
            if (allSelected) onClearSelection();
            else onSelectAll();
          }}
        />
      ),
      renderCell: (params) => {
        if (params.row._type === 'directory') return null;
        return (
          <Checkbox
            size="small"
            checked={selected.has(params.row.id)}
            onChange={() => onToggleSelect(params.row.id)}
          />
        );
      },
    },
    {
      field: 'preview',
      headerName: '预览',
      width: 64,
      sortable: false,
      renderCell: (params) => {
        if (params.row._type === 'directory') {
          return (
            <Box sx={{ width: 48, height: 48, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <FolderIcon color="warning" sx={{ fontSize: 32 }} />
            </Box>
          );
        }
        return (
          <Box
            component="img"
            src={`/${params.row.id}`}
            alt={params.row.original_name || params.row.file_name}
            loading="lazy"
            sx={{
              width: 48,
              height: 48,
              objectFit: 'cover',
              borderRadius: BORDER_RADIUS.sm,
              display: 'block',
              cursor: 'pointer',
              '&:hover': { opacity: 0.8 },
            }}
            onClick={() => onOpenDetail(null, params.row)}
          />
        );
      },
    },
    {
      field: 'name',
      headerName: '文件名',
      flex: 1,
      minWidth: 180,
      renderCell: (params) => {
        const name = params.row._type === 'directory'
          ? params.row.name
          : (params.row.original_name || params.row.file_name);
        return (
          <Typography variant="body2" fontWeight={params.row._type === 'directory' ? 'medium' : 'normal'} noWrap>
            {name}
          </Typography>
        );
      },
    },
    {
      field: 'tags',
      headerName: '标签',
      width: 150,
      sortable: false,
      renderCell: (params) => {
        if (params.row._type === 'directory') {
          return <Typography variant="caption" color="text.secondary">-</Typography>;
        }
        const tags = parseTags(params.row.tags);
        if (tags.length === 0) {
          return <Typography variant="caption" color="text.secondary">-</Typography>;
        }
        return (
          <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
            {tags.map(tag => (
              <Chip key={tag} label={tag} size="small" variant="outlined" color="primary" sx={{ fontSize: 10, height: 20 }} />
            ))}
          </Box>
        );
      },
    },
    {
      field: 'storage_channel',
      headerName: '渠道类型',
      width: 100,
      valueGetter: (value, row) => row._type === 'file' ? channelTypeLabel(row.storage_channel) : '-',
      renderCell: (params) => {
        if (params.row._type === 'directory') {
          return <Typography variant="caption" color="text.secondary">-</Typography>;
        }
        return <Chip label={params.value} size="small" variant="outlined" sx={{ fontSize: 11 }} />;
      },
    },
    {
      field: 'storage_config',
      headerName: '渠道名称',
      width: 120,
      valueGetter: (value, row) => row._type === 'file' ? parseChannelName(row.storage_config) : '-',
      renderCell: (params) => (
        <Typography variant="body2" color="text.secondary" noWrap>
          {params.value}
        </Typography>
      ),
    },
    {
      field: 'size',
      headerName: '大小',
      width: 80,
      renderCell: (params) => {
        if (params.row._type === 'directory') {
          return <Typography variant="caption" color="text.secondary">-</Typography>;
        }
        return (
          <Typography variant="body2" color="text.secondary" noWrap>
            {fmtSize(params.row.size)}
          </Typography>
        );
      },
    },
    {
      field: 'directory',
      headerName: '目录',
      width: 100,
      renderCell: (params) => (
        <Typography variant="body2" color="text.secondary" noWrap>
          {params.row._type === 'directory' ? params.row.path : params.row.directory}
        </Typography>
      ),
    },
    {
      field: 'created_at',
      headerName: '上传时间',
      width: 120,
      renderCell: (params) => {
        if (params.row._type === 'directory') {
          return <Typography variant="caption" color="text.secondary">-</Typography>;
        }
        return (
          <Typography variant="body2" color="text.secondary">
            {fmtDate(params.row.created_at)}
          </Typography>
        );
      },
    },
    {
      field: 'actions',
      headerName: '操作',
      width: 100,
      sortable: false,
      renderCell: (params) => {
        if (params.row._type === 'directory') return null;
        const name = params.row.original_name || params.row.file_name;
        return (
          <Box sx={{ display: 'flex', justifyContent: 'flex-end', gap: 0.5 }}>
            <Tooltip title="详情">
              <IconButton
                size="small"
                color="primary"
                onClick={(event) => onOpenDetail(event.currentTarget, params.row)}
              >
                <InfoIcon fontSize="small" />
              </IconButton>
            </Tooltip>
            <Tooltip title="删除">
              <IconButton
                size="small"
                color="error"
                onClick={(event) => onTriggerDelete(event.currentTarget, [params.row.id], name)}
              >
                <DeleteIcon fontSize="small" />
              </IconButton>
            </Tooltip>
          </Box>
        );
      },
    },
  ];

  return (
    <Box sx={{ height: '100%' }}>
      <GenericDataGrid
        rows={rows}
        columns={columns}
        pagination={{ enabled: false }}
        onRowClick={handleRowClick}
        getRowClassName={getRowClassName}
        rowSx={{
          '&.directory-row': { cursor: 'pointer' },
          '&.directory-row .MuiDataGrid-cell': { cursor: 'pointer' },
        }}
        sx={{ height: '100%' }}
        localeText={{
          noRowsLabel: '暂无文件',
        }}
      />
    </Box>
  );
}
