import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import Typography from '@mui/material/Typography';
import List from '@mui/material/List';
import ListItem from '@mui/material/ListItem';
import ListItemButton from '@mui/material/ListItemButton';
import ListItemText from '@mui/material/ListItemText';
import Badge from '@mui/material/Badge';
import Box from '@mui/material/Box';
import { useNavigate } from 'react-router-dom';

export default function TopFilesTree({ data }) {
  const navigate = useNavigate();

  if (!data || !data.topFiles || data.topFiles.length === 0) {
    return (
      <Card
        variant="outlined"
        sx={{ display: 'flex', flexDirection: 'column', gap: '8px', flexGrow: 1 }}
      >
        <CardContent>
          <Typography component="h2" variant="subtitle2">
            热门文件
          </Typography>
          <Typography variant="body2" sx={{ color: 'text.secondary', mt: 2 }}>
            暂无访问数据
          </Typography>
        </CardContent>
      </Card>
    );
  }

  const handleFileClick = (fileId) => {
    navigate(`/admin/files?highlight=${fileId}`);
  };

  return (
    <Card
      variant="outlined"
      sx={{ display: 'flex', flexDirection: 'column', gap: '8px', flexGrow: 1 }}
    >
      <CardContent>
        <Typography component="h2" variant="subtitle2" gutterBottom>
          热门文件 TOP 5
        </Typography>
        <Typography variant="caption" sx={{ color: 'text.secondary' }}>
          近 7 天访问排名
        </Typography>
        <List sx={{ mt: 1, p: 0 }}>
          {data.topFiles.map((file, index) => (
            <ListItem key={file.fileId} disablePadding>
              <ListItemButton
                onClick={() => handleFileClick(file.fileId)}
                sx={{ borderRadius: 1 }}
              >
                <Box
                  sx={{
                    minWidth: 24,
                    height: 24,
                    borderRadius: '50%',
                    backgroundColor: 'primary.main',
                    color: 'white',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: '0.75rem',
                    fontWeight: 'bold',
                    mr: 2,
                  }}
                >
                  {index + 1}
                </Box>
                <ListItemText
                  primary={file.originalName || file.fileName}
                  primaryTypographyProps={{
                    variant: 'body2',
                    noWrap: true,
                  }}
                  secondary={`${file.accessCount} 次访问`}
                  secondaryTypographyProps={{
                    variant: 'caption',
                  }}
                />
                <Badge
                  badgeContent={file.accessCount}
                  color="primary"
                  max={9999}
                  sx={{ ml: 2 }}
                />
              </ListItemButton>
            </ListItem>
          ))}
        </List>
      </CardContent>
    </Card>
  );
}
