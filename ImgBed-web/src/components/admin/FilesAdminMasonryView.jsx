import { Paper, Typography } from '@mui/material';
import FolderIcon from '@mui/icons-material/Folder';
import Masonry from '@mui/lab/Masonry';
import MasonryImageItem from './MasonryImageItem';
import { BORDER_RADIUS } from '../../utils/constants';

function DirectoryCard({ dir, onNavigateToDir }) {
  return (
    <Paper
      variant="outlined"
      onClick={() => onNavigateToDir(dir.path)}
      sx={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 1,
        p: 3,
        aspectRatio: '1',
        cursor: 'pointer',
        borderRadius: BORDER_RADIUS.md,
        bgcolor: 'background.paper',
        '&:hover': { bgcolor: 'action.hover', borderColor: 'primary.main' },
        transition: 'all 0.15s',
      }}
    >
      <FolderIcon color="warning" sx={{ fontSize: 48 }} />
      <Typography variant="body2" fontWeight="medium" textAlign="center" noWrap sx={{ width: '100%', px: 1 }}>
        {dir.name}
      </Typography>
    </Paper>
  );
}

export default function FilesAdminMasonryView({
  directories,
  data,
  cols,
  selected,
  onNavigateToDir,
  onToggleSelect,
  onTriggerDelete,
  onOpenDetail,
}) {
  return (
    <Masonry columns={cols} spacing={1.5} defaultColumns={cols} defaultHeight={800} sx={{ alignContent: 'flex-start' }}>
      {directories.map((dir) => (
        <DirectoryCard key={`dir-${dir.path}`} dir={dir} onNavigateToDir={onNavigateToDir} />
      ))}
      {data.map((item) => (
        <MasonryImageItem
          key={item.id}
          item={item}
          isSelected={selected.has(item.id)}
          toggleSelect={onToggleSelect}
          triggerDelete={onTriggerDelete}
          onOpenDetail={onOpenDetail}
        />
      ))}
    </Masonry>
  );
}
