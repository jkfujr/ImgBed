import React from 'react';
import { Outlet, useNavigate, useLocation } from 'react-router-dom';
import { Box, Toolbar, Typography, Button, IconButton, Menu, MenuItem, ListItemIcon, Divider, TextField, InputAdornment } from '@mui/material';
import CloudUploadIcon from '@mui/icons-material/CloudUpload';
import AccountCircle from '@mui/icons-material/AccountCircle';
import LogoutIcon from '@mui/icons-material/Logout';
import ManageAccountsIcon from '@mui/icons-material/ManageAccounts';
import AddIcon from '@mui/icons-material/Add';
import ImageIcon from '@mui/icons-material/Image';
import FolderIcon from '@mui/icons-material/Folder';
import ContentPasteIcon from '@mui/icons-material/ContentPaste';
import CreateNewFolderIcon from '@mui/icons-material/CreateNewFolder';
import StorageIcon from '@mui/icons-material/Storage';
import SearchIcon from '@mui/icons-material/Search';
import { useAuth } from '../hooks/useAuth';
import { AppBar } from '@mui/material';
import DashboardIcon from '@mui/icons-material/Dashboard';
import LoginIcon from '@mui/icons-material/Login';
import { BORDER_RADIUS } from '../utils/constants';
import PasteUploadDialog from '../components/common/PasteUploadDialog';
import CreateFolderDialog from '../components/common/CreateFolderDialog';
import ChannelDialog from '../components/common/ChannelDialog';
import SearchDialog from '../components/common/SearchDialog';

export default function MainLayout() {
  const { isAuthenticated, logout, user } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [anchorEl, setAnchorEl] = React.useState(null);
  const [createMenuAnchor, setCreateMenuAnchor] = React.useState(null);
  const fileInputRef = React.useRef(null);
  const dirInputRef = React.useRef(null);
  const [pasteDialogOpen, setPasteDialogOpen] = React.useState(false);
  const [folderDialogOpen, setFolderDialogOpen] = React.useState(false);
  const [channelDialogOpen, setChannelDialogOpen] = React.useState(false);
  const [searchDialogOpen, setSearchDialogOpen] = React.useState(false);

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

  const handleCreateMenuOpen = (event) => {
    setCreateMenuAnchor(event.currentTarget);
  };

  const handleCreateMenuClose = () => {
    setCreateMenuAnchor(null);
  };

  const handleUploadImage = () => {
    handleCreateMenuClose();
    fileInputRef.current?.click();
  };

  const handleUploadDirectory = () => {
    handleCreateMenuClose();
    dirInputRef.current?.click();
  };

  const handleFileChange = async (e) => {
    const files = Array.from(e.target.files || []);
    if (files.length === 0) return;

    for (let i = 0; i < files.length; i++) {
      try {
        const formData = new FormData();
        formData.append('file', files[i]);
        await fetch('/api/upload', {
          method: 'POST',
          body: formData,
          credentials: 'include'
        });
      } catch (err) {
        console.error('上传失败:', files[i].name, err);
      }
    }

    e.target.value = null;

    // 如果在文件管理页面，触发刷新
    if (location.pathname === '/admin/files') {
      window.location.reload();
    }
  };

  const handlePasteUpload = () => {
    handleCreateMenuClose();
    setPasteDialogOpen(true);
  };

  const handleCreateFolder = () => {
    handleCreateMenuClose();
    setFolderDialogOpen(true);
  };

  const handlePasteUploadFile = async (file) => {
    try {
      const formData = new FormData();
      formData.append('file', file);
      await fetch('/api/upload', {
        method: 'POST',
        body: formData,
        credentials: 'include'
      });
      if (location.pathname === '/admin/files') {
        window.location.reload();
      }
    } catch (err) {
      console.error('上传失败:', err);
    }
  };

  const handleCreateFolderConfirm = async (folderPath) => {
    // 通过上传一个占位文件来创建目录
    try {
      const placeholderFile = new File([''], '.gitkeep', { type: 'text/plain' });
      const formData = new FormData();
      formData.append('file', placeholderFile);
      await fetch(`/api/upload?uploadFolder=${encodeURIComponent(folderPath)}`, {
        method: 'POST',
        body: formData,
        credentials: 'include'
      });
      if (location.pathname === '/admin/files') {
        window.location.reload();
      }
    } catch (err) {
      console.error('创建文件夹失败:', err);
    }
  };

  const handleAddChannel = () => {
    handleCreateMenuClose();
    setChannelDialogOpen(true);
  };

  const isPublicArea = !location.pathname.startsWith('/admin');
  const showCreateButton = isAuthenticated && !isPublicArea;

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', height: '100vh', overflow: 'hidden', width: '100%' }}>
      <AppBar position="static" elevation={0} color="inherit" sx={{ borderBottom: 1, borderColor: 'divider' }}>
        <Toolbar>
          {/* Logo 区域（在管理后台时占据侧边栏宽度） */}
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

          {/* 新建按钮（仅管理后台显示） */}
          {showCreateButton && (
            <Button
              variant="contained"
              color="primary"
              startIcon={<AddIcon />}
              onClick={handleCreateMenuOpen}
              sx={{ borderRadius: BORDER_RADIUS.md, ml: 2 }}
            >
              新建
            </Button>
          )}

          {/* 搜索框 */}
          {showCreateButton && (
            <TextField
              size="small"
              placeholder="搜索"
              onClick={() => setSearchDialogOpen(true)}
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

          {/* 右侧区域 */}
          <Box sx={{ flexGrow: 1 }} />

          {/* User / Authentication Dropdown Area */}
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

          {/* 新建菜单 */}
          <Menu
            anchorEl={createMenuAnchor}
            open={Boolean(createMenuAnchor)}
            onClose={handleCreateMenuClose}
            transformOrigin={{ horizontal: 'left', vertical: 'top' }}
            anchorOrigin={{ horizontal: 'left', vertical: 'bottom' }}
            PaperProps={{
              elevation: 3,
              sx: { mt: 1, minWidth: 180, borderRadius: BORDER_RADIUS.md }
            }}
          >
            <MenuItem onClick={handleUploadImage}>
              <ListItemIcon><ImageIcon fontSize="small" /></ListItemIcon>
              上传图片
            </MenuItem>
            <MenuItem onClick={handleUploadDirectory}>
              <ListItemIcon><FolderIcon fontSize="small" /></ListItemIcon>
              上传目录
            </MenuItem>
            <MenuItem onClick={handlePasteUpload}>
              <ListItemIcon><ContentPasteIcon fontSize="small" /></ListItemIcon>
              剪贴板上传
            </MenuItem>
            <Divider />
            <MenuItem onClick={handleCreateFolder}>
              <ListItemIcon><CreateNewFolderIcon fontSize="small" /></ListItemIcon>
              创建文件夹
            </MenuItem>
            <MenuItem onClick={handleAddChannel}>
              <ListItemIcon><StorageIcon fontSize="small" /></ListItemIcon>
              新增渠道
            </MenuItem>
          </Menu>

          {/* 隐藏的文件输入 */}
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            multiple
            style={{ display: 'none' }}
            onChange={handleFileChange}
          />
          <input
            ref={dirInputRef}
            type="file"
            webkitdirectory=""
            directory=""
            multiple
            style={{ display: 'none' }}
            onChange={handleFileChange}
          />
        </Toolbar>
      </AppBar>

      {/* 内容主体 */}
      <Box sx={{ flexGrow: 1, display: 'flex', flexDirection: 'column', bgcolor: 'background.default', overflow: 'hidden', minHeight: 0 }}>
          <Outlet />
      </Box>

      {/* 剪贴板上传弹窗 */}
      <PasteUploadDialog
        open={pasteDialogOpen}
        onClose={() => setPasteDialogOpen(false)}
        onUpload={handlePasteUploadFile}
      />

      {/* 创建文件夹弹窗 */}
      <CreateFolderDialog
        open={folderDialogOpen}
        onClose={() => setFolderDialogOpen(false)}
        onConfirm={handleCreateFolderConfirm}
      />

      {/* 新增渠道弹窗 */}
      <ChannelDialog
        open={channelDialogOpen}
        onClose={() => setChannelDialogOpen(false)}
        editTarget={null}
        onSuccess={() => setChannelDialogOpen(false)}
      />

      {/* 搜索对话框 */}
      <SearchDialog
        open={searchDialogOpen}
        onClose={() => setSearchDialogOpen(false)}
      />
    </Box>
  );
}
