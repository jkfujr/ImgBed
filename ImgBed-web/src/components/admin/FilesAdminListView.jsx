import React from 'react';
import {
  Box, Checkbox, Chip, IconButton, Table, TableBody, TableCell, TableHead, TableRow, Tooltip, Typography,
} from '@mui/material';
import DeleteIcon from '@mui/icons-material/Delete';
import InfoIcon from '@mui/icons-material/Info';
import FolderIcon from '@mui/icons-material/Folder';
import { BORDER_RADIUS } from '../../utils/constants';
import { fmtDate, fmtSize, parseChannelName, channelTypeLabel, parseTags } from '../../utils/formatters';

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
  return (
    <Table size="small" stickyHeader>
      <TableHead>
        <TableRow>
          <TableCell padding="checkbox">
            <Checkbox
              size="small"
              indeterminate={selected.size > 0 && selected.size < data.length}
              checked={data.length > 0 && selected.size === data.length}
              onChange={() => {
                if (selected.size === data.length) onClearSelection();
                else onSelectAll();
              }}
            />
          </TableCell>
          <TableCell sx={{ width: 64 }}>预览</TableCell>
          <TableCell>文件名</TableCell>
          <TableCell>标签</TableCell>
          <TableCell>渠道类型</TableCell>
          <TableCell>渠道名称</TableCell>
          <TableCell>大小</TableCell>
          <TableCell>目录</TableCell>
          <TableCell>上传时间</TableCell>
          <TableCell align="right">操作</TableCell>
        </TableRow>
      </TableHead>
      <TableBody>
        {directories.map((dir) => (
          <TableRow
            key={`dir-${dir.path}`}
            hover
            onClick={() => onNavigateToDir(dir.path)}
            sx={{ cursor: 'pointer', '&:hover': { bgcolor: 'action.hover' } }}
          >
            <TableCell padding="checkbox" />
            <TableCell sx={{ width: 64, p: 0.5 }}>
              <Box sx={{ width: 48, height: 48, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <FolderIcon color="warning" sx={{ fontSize: 32 }} />
              </Box>
            </TableCell>
            <TableCell sx={{ maxWidth: 280 }}>
              <Typography variant="body2" fontWeight="medium">{dir.name}</Typography>
            </TableCell>
            <TableCell><Typography variant="caption" color="text.secondary">-</Typography></TableCell>
            <TableCell><Typography variant="caption" color="text.secondary">-</Typography></TableCell>
            <TableCell><Typography variant="caption" color="text.secondary">-</Typography></TableCell>
            <TableCell><Typography variant="caption" color="text.secondary">-</Typography></TableCell>
            <TableCell>
              <Typography variant="body2" color="text.secondary">{dir.path}</Typography>
            </TableCell>
            <TableCell><Typography variant="caption" color="text.secondary">-</Typography></TableCell>
            <TableCell align="right" />
          </TableRow>
        ))}
        {data.map((item) => {
          const tags = parseTags(item.tags);
          return (
            <TableRow key={item.id} hover selected={selected.has(item.id)}>
              <TableCell padding="checkbox">
                <Checkbox size="small" checked={selected.has(item.id)} onChange={() => onToggleSelect(item.id)} />
              </TableCell>
              <TableCell sx={{ width: 64, p: 0.5 }}>
                <Box
                  component="img"
                  src={`/${item.id}`}
                  alt={item.original_name || item.file_name}
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
                  onClick={() => onOpenDetail(item)}
                />
              </TableCell>
              <TableCell sx={{ maxWidth: 280 }}>
                <Typography variant="body2" noWrap>{item.original_name || item.file_name}</Typography>
              </TableCell>
              <TableCell>
                <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
                  {tags.length > 0 ? (
                    tags.map((tag, idx) => (
                      <Chip key={idx} label={tag} size="small" variant="outlined" color="primary" sx={{ fontSize: 10, height: 20 }} />
                    ))
                  ) : (
                    <Typography variant="caption" color="text.secondary">-</Typography>
                  )}
                </Box>
              </TableCell>
              <TableCell>
                <Chip label={channelTypeLabel(item.storage_channel)} size="small" variant="outlined" sx={{ fontSize: 11 }} />
              </TableCell>
              <TableCell>
                <Typography variant="body2" color="text.secondary">{parseChannelName(item.storage_config)}</Typography>
              </TableCell>
              <TableCell>
                <Typography variant="body2" color="text.secondary" noWrap>{fmtSize(item.size)}</Typography>
              </TableCell>
              <TableCell>
                <Typography variant="body2" color="text.secondary">{item.directory || '/'}</Typography>
              </TableCell>
              <TableCell>
                <Typography variant="body2" color="text.secondary">{fmtDate(item.created_at)}</Typography>
              </TableCell>
              <TableCell align="right">
                <Box sx={{ display: 'flex', justifyContent: 'flex-end', gap: 0.5 }}>
                  <Tooltip title="详情">
                    <IconButton size="small" color="primary" onClick={() => onOpenDetail(item)}>
                      <InfoIcon fontSize="small" />
                    </IconButton>
                  </Tooltip>
                  <Tooltip title="删除">
                    <IconButton size="small" color="error" onClick={() => onTriggerDelete([item.id], item.original_name || item.file_name)}>
                      <DeleteIcon fontSize="small" />
                    </IconButton>
                  </Tooltip>
                </Box>
              </TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}
