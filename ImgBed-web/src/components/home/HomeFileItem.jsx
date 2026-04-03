import { memo } from 'react';
import {
  Box, IconButton, LinearProgress, ListItem, Tooltip, Typography
} from '@mui/material';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import ErrorIcon from '@mui/icons-material/Error';
import { BORDER_RADIUS } from '../../utils/constants';

function HomeFileItem({ entry, uploading, onCopy, onRemove }) {
  return (
    <ListItem
      disablePadding
      sx={{ px: 1.5, py: 1, display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}
    >
      <Box
        component="img"
        src={entry.previewUrl}
        alt={entry.file.name}
        sx={{ width: 48, height: 48, objectFit: 'cover', borderRadius: BORDER_RADIUS.sm, flexShrink: 0 }}
      />
      <Box sx={{ flexGrow: 1, minWidth: 0 }}>
        <Typography variant="body2" noWrap title={entry.file.name}>
          {entry.file.name}
        </Typography>
        {entry.status === 'uploading' && <LinearProgress sx={{ mt: 0.5, height: 3, borderRadius: BORDER_RADIUS.sm }} />}
        {entry.status === 'error' && (
          <Typography variant="caption" color="error">{entry.errorMsg}</Typography>
        )}
        {entry.status === 'done' && entry.result && (
          <Box display="flex" alignItems="center" gap={0.5} mt={0.5}>
            <Typography variant="caption" color="text.secondary" noWrap sx={{ maxWidth: 240 }}>
              {entry.result.fullUrl}
            </Typography>
            <Tooltip title="复制链接">
              <IconButton size="small" onClick={() => onCopy(entry.result.fullUrl)}>
                <ContentCopyIcon sx={{ fontSize: 14 }} />
              </IconButton>
            </Tooltip>
          </Box>
        )}
      </Box>
      {entry.status === 'done' && <CheckCircleIcon color="success" fontSize="small" />}
      {entry.status === 'error' && <ErrorIcon color="error" fontSize="small" />}
      {entry.status !== 'uploading' && (
        <Tooltip title="移除">
          <IconButton size="small" onClick={() => onRemove(entry.id)} disabled={uploading && entry.status === 'uploading'}>
            <DeleteOutlineIcon fontSize="small" />
          </IconButton>
        </Tooltip>
      )}
    </ListItem>
  );
}

export default memo(HomeFileItem, (prev, next) => (
  prev.entry.id === next.entry.id
  && prev.entry.status === next.entry.status
  && prev.uploading === next.uploading
  && prev.entry.result?.fullUrl === next.entry.result?.fullUrl
  && prev.entry.errorMsg === next.entry.errorMsg
));
