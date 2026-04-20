import { useMemo, useRef, useState } from 'react';
import { Outlet, useNavigate, useLocation } from 'react-router-dom';
import {
  Box,
  Toolbar,
  Typography,
  IconButton,
  Menu,
  MenuItem,
  ListItemIcon,
  Divider,
  TextField,
  InputAdornment,
  AppBar,
  Tooltip
} from '@mui/material';
import CloudUploadIcon from '@mui/icons-material/CloudUpload';
import AccountCircle from '@mui/icons-material/AccountCircle';
import LogoutIcon from '@mui/icons-material/Logout';
import ManageAccountsIcon from '@mui/icons-material/ManageAccounts';
import SearchIcon from '@mui/icons-material/Search';
import DashboardIcon from '@mui/icons-material/Dashboard';
import LoginIcon from '@mui/icons-material/Login';
import LightModeIcon from '@mui/icons-material/LightMode';
import DarkModeIcon from '@mui/icons-material/DarkMode';
import SettingsBrightnessIcon from '@mui/icons-material/SettingsBrightness';
import { useAuth } from '../hooks/useAuth';
import { useThemeMode } from '../hooks/useThemeMode';
import { BORDER_RADIUS } from '../utils/constants';
import { createOverlayFocusManager } from '../utils/overlay-focus';
import SearchDialog from '../components/common/SearchDialog';
import CreateActionButton from '../components/layout/CreateActionButton';
import { getDirectoryPathFromSearch, ROOT_DIR } from '../admin/filesAdminShared';

export default function MainLayout() {
  const { isAuthenticated, logout, user } = useAuth();
  const { themeMode, setThemeMode } = useThemeMode();
  const navigate = useNavigate();
  const location = useLocation();
  const [anchorEl, setAnchorEl] = useState(null);
  const [searchDialogOpen, setSearchDialogOpen] = useState(false);
  const searchDialogFocusManagerRef = useRef(null);

  if (searchDialogFocusManagerRef.current == null) {
    searchDialogFocusManagerRef.current = createOverlayFocusManager();
  }

  const searchDialogFocusManager = searchDialogFocusManagerRef.current;

  const handleMenuOpen = (event) => {
    setAnchorEl(event.currentTarget);
  };

  const handleMenuClose = () => {
    setAnchorEl(null);
  };

  const handleNavigate = (path) => {
    handleMenuClose();
    navigate(path);
  };

  const handleLogout = async () => {
    handleMenuClose();
    await logout();
    navigate('/');
  };

  const handleThemeToggle = () => {
    const modes = ['light', 'dark', 'auto'];
    const currentIndex = modes.indexOf(themeMode);
    const nextIndex = (currentIndex + 1) % modes.length;
    setThemeMode(modes[nextIndex]);
  };

  const getThemeIcon = () => {
    switch (themeMode) {
      case 'light':
        return <LightModeIcon />;
      case 'dark':
        return <DarkModeIcon />;
      case 'auto':
        return <SettingsBrightnessIcon />;
      default:
        return <LightModeIcon />;
    }
  };

  const getThemeLabel = () => {
    switch (themeMode) {
      case 'light':
        return '亮色模式';
      case 'dark':
        return '暗色模式';
      case 'auto':
        return '自动模式';
      default:
        return '亮色模式';
    }
  };

  const isPublicArea = !location.pathname.startsWith('/admin');
  const showCreateButton = isAuthenticated && !isPublicArea;
  const createButtonDir = useMemo(() => {
    if (location.pathname !== '/admin/files') {
      return ROOT_DIR;
    }
    return getDirectoryPathFromSearch(location.search);
  }, [location.pathname, location.search]);

  const handleSearchDialogOpen = () => {
    searchDialogFocusManager.open(null, () => setSearchDialogOpen(true));
  };

  const handleSearchDialogClose = () => {
    searchDialogFocusManager.close(() => setSearchDialogOpen(false));
  };

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', height: '100vh', overflow: 'hidden', width: '100%' }}>
      <AppBar position="static" elevation={0} color="inherit" sx={{ borderBottom: 1, borderColor: 'divider' }}>
        <Toolbar>
          <Box sx={{
            display: 'flex',
            alignItems: 'center',
            width: showCreateButton ? 225 : 'auto',
            flexShrink: 0
          }}>
            <IconButton edge="start" color="primary" onClick={() => navigate('/')} sx={{ mr: 1 }}>
               <CloudUploadIcon />
            </IconButton>
            <Typography variant="h6" component="div" sx={{ fontWeight: 'bold', cursor: 'pointer' }} onClick={() => navigate('/')}>
              ImgBed
            </Typography>
          </Box>

          {showCreateButton && <CreateActionButton currentDir={createButtonDir} />}

          {showCreateButton && (
            <TextField
              size="small"
              placeholder="搜索"
              onClick={handleSearchDialogOpen}
              sx={{ ml: 2, width: 200, cursor: 'pointer' }}
              slotProps={{
                input: {
                  readOnly: true,
                  startAdornment: (
                    <InputAdornment position="start">
                      <SearchIcon fontSize="small" />
                    </InputAdornment>
                  )
                }
              }}
            />
          )}

          <Box sx={{ flexGrow: 1 }} />

          <Tooltip title={getThemeLabel()}>
            <IconButton
              onClick={handleThemeToggle}
              color="primary"
              sx={{ mr: 1 }}
            >
              {getThemeIcon()}
            </IconButton>
          </Tooltip>

          <IconButton
            size="large"
            color="primary"
            onClick={handleMenuOpen}
          >
            <AccountCircle />
          </IconButton>

          <Menu
            anchorEl={anchorEl}
            open={Boolean(anchorEl)}
            onClose={handleMenuClose}
            transformOrigin={{ horizontal: 'right', vertical: 'top' }}
            anchorOrigin={{ horizontal: 'right', vertical: 'bottom' }}
            PaperProps={{
               elevation: 3,
               sx: { mt: 1, minWidth: 150, borderRadius: BORDER_RADIUS.md }
            }}
          >
            {isAuthenticated ? [
               <MenuItem key="user-info" disabled sx={{ opacity: '1 !important' }}>
                  <Typography variant="body2" fontWeight="bold" color="text.primary">
                     {user?.username || '管理员'}
                  </Typography>
               </MenuItem>,
               <Divider key="divider" />,
               isPublicArea && (
                  <MenuItem key="admin" onClick={() => handleNavigate('/admin')}>
                     <ListItemIcon><DashboardIcon fontSize="small" /></ListItemIcon>
                     管理后台
                  </MenuItem>
               ),
               !isPublicArea && (
                  <MenuItem key="settings" onClick={() => handleNavigate('/admin/settings')}>
                     <ListItemIcon><ManageAccountsIcon fontSize="small" /></ListItemIcon>
                     用户管理
                  </MenuItem>
               ),
               <MenuItem key="logout" onClick={handleLogout} sx={{ color: 'error.main' }}>
                  <ListItemIcon><LogoutIcon fontSize="small" color="error" /></ListItemIcon>
                  退出登录
               </MenuItem>
            ] : (
               <MenuItem onClick={() => handleNavigate('/login')}>
                  <ListItemIcon><LoginIcon fontSize="small" /></ListItemIcon>
                  登录
               </MenuItem>
            )}
          </Menu>
        </Toolbar>
      </AppBar>

      <Box sx={{ flexGrow: 1, display: 'flex', flexDirection: 'column', bgcolor: 'background.default', overflow: 'hidden', minHeight: 0 }}>
          <Outlet />
      </Box>

      <SearchDialog
        open={searchDialogOpen}
        onClose={handleSearchDialogClose}
      />
    </Box>
  );
}
