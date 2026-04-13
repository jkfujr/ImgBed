import { Box, Typography, Paper, Divider, Chip, Button } from '@mui/material';
import DeleteIcon from '@mui/icons-material/Delete';
import ImageIcon from '@mui/icons-material/Image';
import { fmtDate, fmtSize, parseChannelName, channelTypeLabel, parseTags } from '../../utils/formatters';
import { BORDER_RADIUS } from '../../utils/constants';

/**
 * ImageDetailLightbox 右侧详情面板
 */
export default function ImageDetailPanel({ item, theme, onClose, onDelete }) {
  const escapeHtml = (str) => {
    if (!str) return '';
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;');
  };

  const infoItems = [
    { label: '文件名', value: escapeHtml(item.original_name || item.file_name) },
    { label: '文件类型', value: item.mime_type },
    { label: '文件大小', value: fmtSize(item.size) },
    { label: '图片尺寸', value: item.width ? `${item.width} x ${item.height}` : '-' },
    { label: '上传时间', value: fmtDate(item.created_at) },
    { label: '上传用户', value: item.uploader_id || '-' },
    { label: '上传 IP', value: item.upload_ip || '-' },
    { label: '渠道 ID', value: parseChannelName(item.storage_config) },
  ];

  return (
    <Paper
      sx={{
        width: 360,
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        borderRadius: 0,
        bgcolor: 'background.paper',
        zIndex: 10,
        boxShadow: theme.shadows[10]
      }}
    >
      <Box sx={{ p: 3, borderBottom: '1px solid', borderColor: 'divider' }}>
        <Typography variant="h6" fontWeight="bold" noWrap>
          文件详情
        </Typography>
      </Box>

      <Box sx={{ flex: 1, overflowY: 'auto', p: 3 }}>
        {infoItems.map((info) => (
          <Box key={info.label} sx={{ mb: 2.5 }}>
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 0.5, textTransform: 'uppercase', letterSpacing: 1 }}>
              {info.label}
            </Typography>
            <Typography variant="body2" fontWeight="medium" sx={{ wordBreak: 'break-all' }}>
              {info.value}
            </Typography>
          </Box>
        ))}

        <Box sx={{ mb: 2.5 }}>
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1, textTransform: 'uppercase' }}>
            渠道类型
          </Typography>
          <Chip
            label={channelTypeLabel(item.storage_channel)}
            size="small"
            color="primary"
            sx={{ borderRadius: BORDER_RADIUS.sm, fontWeight: 'bold' }}
          />
        </Box>

        <Box sx={{ mt: 1 }}>
          <Typography variant="caption" color="text.secondary" sx={{ mb: 1, display: 'block', textTransform: 'uppercase' }}>
            文件标签
          </Typography>
          <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
            {parseTags(item.tags).length > 0 ? (
              parseTags(item.tags).map((tag) => (
                <Chip key={tag} label={tag} size="small" variant="filled" sx={{ bgcolor: 'action.selected', borderRadius: BORDER_RADIUS.sm }} />
              ))
            ) : (
              <Typography variant="body2" color="text.disabled">无标签</Typography>
            )}
          </Box>
        </Box>
      </Box>

      <Divider />

      <Box sx={{ p: 3 }}>
        <Button
          variant="contained"
          fullWidth
          color="error"
          startIcon={<DeleteIcon />}
          onClick={(event) => {
            onDelete(event.currentTarget, [item.id], escapeHtml(item.original_name || item.file_name), [item]);
          }}
          sx={{ borderRadius: BORDER_RADIUS.md, py: 1.2, fontWeight: 'bold' }}
        >
          删除此文件
        </Button>
        <Button
          fullWidth
          sx={{ mt: 1, color: 'text.secondary' }}
          onClick={() => window.open(`/${item.id}`, '_blank')}
          startIcon={<ImageIcon />}
        >
          查看原图
        </Button>
      </Box>
    </Paper>
  );
}
