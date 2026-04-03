import { useEffect, useRef, useState } from 'react';
import {
  Box, Breadcrumbs, Divider, IconButton, Link, TextField, ToggleButton, ToggleButtonGroup, Tooltip, Typography
} from '@mui/material';
import NavigateNextIcon from '@mui/icons-material/NavigateNext';
import ViewModuleIcon from '@mui/icons-material/ViewModule';
import ViewListIcon from '@mui/icons-material/ViewList';
import RefreshIcon from '@mui/icons-material/Refresh';
import { BORDER_RADIUS } from '../../utils/constants';

export default function FilesAdminToolbar({
  currentDir,
  breadcrumbs,
  loading,
  viewMode,
  onViewModeChange,
  onRefresh,
  onNavigateToDir,
}) {
  const [pathEditing, setPathEditing] = useState(false);
  const [pathInput, setPathInput] = useState('');
  const pathInputRef = useRef(null);

  useEffect(() => {
    if (!pathEditing) return;
    setPathInput(currentDir || '/');
  }, [currentDir, pathEditing]);

  useEffect(() => {
    if (!pathEditing) return undefined;
    const timer = setTimeout(() => pathInputRef.current?.focus(), 0);
    return () => clearTimeout(timer);
  }, [pathEditing]);

  const commitPathEdit = () => {
    const raw = pathInput.trim();
    let normalized = null;

    if (raw !== '/' && raw !== '') {
      normalized = raw.startsWith('/') ? raw : `/${raw}`;
    }

    onNavigateToDir(normalized);
    setPathEditing(false);
  };

  const cancelPathEdit = () => {
    setPathEditing(false);
    setPathInput(currentDir || '/');
  };

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, flexShrink: 0 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexShrink: 0, flexWrap: 'wrap' }}>
        {pathEditing ? (
          <TextField
            inputRef={pathInputRef}
            size="small"
            value={pathInput}
            onChange={(e) => setPathInput(e.target.value)}
            onBlur={commitPathEdit}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commitPathEdit();
              if (e.key === 'Escape') cancelPathEdit();
            }}
            sx={{ flex: 1, minWidth: 0 }}
            autoFocus
          />
        ) : (
          <Box
            onClick={() => setPathEditing(true)}
            sx={{
              flex: 1,
              minWidth: 0,
              cursor: 'text',
              display: 'flex',
              alignItems: 'center',
              px: 1.5,
              py: 1,
              border: 1,
              borderColor: 'divider',
              borderRadius: BORDER_RADIUS.sm,
              bgcolor: 'background.paper',
              transition: 'border-color 0.15s, box-shadow 0.15s',
              '&:hover': { borderColor: 'primary.main', boxShadow: '0 0 0 1px theme.palette.primary.main' },
            }}
          >
            <Breadcrumbs separator={<NavigateNextIcon fontSize="small" />} sx={{ fontSize: 14 }}>
              <Link
                component="button"
                underline="hover"
                color={currentDir ? 'inherit' : 'text.primary'}
                onClick={(e) => {
                  e.stopPropagation();
                  onNavigateToDir(null);
                }}
                sx={{ cursor: 'pointer', fontWeight: !currentDir ? 'bold' : 'normal', fontSize: 14, border: 'none', background: 'none', p: 0 }}
              >
                根目录
              </Link>
              {breadcrumbs.map((seg, i) => {
                const path = '/' + breadcrumbs.slice(0, i + 1).join('/');
                const isLast = i === breadcrumbs.length - 1;
                return isLast ? (
                  <Typography key={path} fontSize={14} fontWeight="bold" color="text.primary" noWrap>
                    {seg}
                  </Typography>
                ) : (
                  <Link
                    key={path}
                    component="button"
                    underline="hover"
                    color="inherit"
                    onClick={(e) => {
                      e.stopPropagation();
                      onNavigateToDir(path);
                    }}
                    sx={{ cursor: 'pointer', fontSize: 14, border: 'none', background: 'none', p: 0 }}
                  >
                    {seg}
                  </Link>
                );
              })}
            </Breadcrumbs>
          </Box>
        )}

        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexShrink: 0 }}>
          <ToggleButtonGroup value={viewMode} exclusive onChange={onViewModeChange} size="small" sx={{ bgcolor: 'background.paper' }}>
            <ToggleButton value="masonry" aria-label="瀑布流">
              <Tooltip title="瀑布流"><ViewModuleIcon fontSize="small" /></Tooltip>
            </ToggleButton>
            <ToggleButton value="list" aria-label="详细列表">
              <Tooltip title="详细列表"><ViewListIcon fontSize="small" /></Tooltip>
            </ToggleButton>
          </ToggleButtonGroup>
          <IconButton size="small" onClick={onRefresh} disabled={loading}>
            <Tooltip title="刷新"><RefreshIcon fontSize="small" /></Tooltip>
          </IconButton>
        </Box>
      </Box>

      <Divider />
    </Box>
  );
}
