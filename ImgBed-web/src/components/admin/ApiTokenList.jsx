import { useMemo } from 'react';
import {
  Box, Typography, CircularProgress, IconButton, Tooltip, Stack, Chip,
  Table, TableBody, TableCell, TableHead, TableRow, Paper
} from '@mui/material';
import DeleteIcon from '@mui/icons-material/Delete';
import { BORDER_RADIUS } from '../../utils/constants';

const PERMISSION_OPTIONS = [
  { key: 'upload:image', label: '上传图片', description: '允许调用上传接口', defaultChecked: true },
  { key: 'files:read', label: '查看文件列表', description: '允许读取文件列表与文件详情' }
];

const formatDateTime = (value) => {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString('zh-CN', { hour12: false });
};

export default function ApiTokenList({ tokens, loading, onDelete }) {
  const permissionMap = useMemo(() => {
    return PERMISSION_OPTIONS.reduce((map, option) => {
      map[option.key] = option;
      return map;
    }, {});
  }, []);

  return (
    <Paper variant="outlined" sx={{ borderRadius: BORDER_RADIUS.md, overflow: 'hidden' }}>
      {loading ? (
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 5 }}>
          <CircularProgress size={28} />
        </Box>
      ) : tokens.length === 0 ? (
        <Box sx={{ py: 5, textAlign: 'center' }}>
          <Typography color="text.secondary">暂无 API Token</Typography>
        </Box>
      ) : (
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>名称</TableCell>
              <TableCell>前缀</TableCell>
              <TableCell>权限</TableCell>
              <TableCell>过期时间</TableCell>
              <TableCell>最后使用</TableCell>
              <TableCell>创建时间</TableCell>
              <TableCell align="right">操作</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {tokens.map((token) => (
              <TableRow key={token.id} hover>
                <TableCell>
                  <Stack spacing={0.5}>
                    <Typography variant="body2" fontWeight="medium">{token.name}</Typography>
                    <Typography variant="caption" color="text.secondary">
                      {token.is_expired ? '已过期' : '生效中'}
                    </Typography>
                  </Stack>
                </TableCell>
                <TableCell>{token.token_prefix}</TableCell>
                <TableCell>
                  <Stack direction="row" spacing={0.5} useFlexGap flexWrap="wrap">
                    {(token.permissions || []).map((permission) => (
                      <Chip
                        key={permission}
                        size="small"
                        label={permissionMap[permission]?.label || permission}
                        variant="outlined"
                      />
                    ))}
                  </Stack>
                </TableCell>
                <TableCell>{token.expires_at ? formatDateTime(token.expires_at) : '永不过期'}</TableCell>
                <TableCell>{formatDateTime(token.last_used_at)}</TableCell>
                <TableCell>{formatDateTime(token.created_at)}</TableCell>
                <TableCell align="right">
                  <Tooltip title="删除">
                    <IconButton color="error" size="small" onClick={() => onDelete(token)}>
                      <DeleteIcon fontSize="small" />
                    </IconButton>
                  </Tooltip>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </Paper>
  );
}
