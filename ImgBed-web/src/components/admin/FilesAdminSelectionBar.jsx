import { Divider, Paper, Button, Typography } from '@mui/material';
import DeleteIcon from '@mui/icons-material/Delete';
import CompareArrowsIcon from '@mui/icons-material/CompareArrows';
import DriveFileMoveIcon from '@mui/icons-material/DriveFileMove';
import { BORDER_RADIUS } from '../../utils/constants';

export default function FilesAdminSelectionBar({
  selectedCount,
  onOpenMove,
  onOpenMigrate,
  onDeleteSelected,
  onClearSelection,
}) {
  if (selectedCount <= 0) return null;

  return (
    <Paper
      elevation={6}
      sx={{
        position: 'fixed',
        bottom: 28,
        left: '50%',
        transform: 'translateX(-50%)',
        zIndex: 1200,
        px: 3,
        py: 1.5,
        display: 'flex',
        alignItems: 'center',
        gap: 1.5,
        borderRadius: BORDER_RADIUS.lg,
        whiteSpace: 'nowrap',
      }}
    >
      <Typography variant="body2" fontWeight="medium">已选 {selectedCount} 项</Typography>
      <Divider orientation="vertical" flexItem />
      <Button
        size="small"
        color="primary"
        variant="outlined"
        startIcon={<DriveFileMoveIcon />}
        onClick={(event) => onOpenMove(event.currentTarget)}
      >
        移动
      </Button>
      <Button
        size="small"
        color="primary"
        variant="outlined"
        startIcon={<CompareArrowsIcon />}
        onClick={(event) => onOpenMigrate(event.currentTarget)}
      >
        迁移
      </Button>
      <Button
        size="small"
        color="error"
        variant="contained"
        startIcon={<DeleteIcon />}
        onClick={(event) => onDeleteSelected(event.currentTarget)}
      >
        删除
      </Button>
      <Button size="small" onClick={onClearSelection}>取消选择</Button>
    </Paper>
  );
}
