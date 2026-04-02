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
import { useRefresh } from '../contexts/RefreshContext';

export default function MainLayout() {
  const { isAuthenticated, logout, user } = useAuth();
  const { triggerRefresh } = useRefresh();
  const navigate = useNavigate();
  const location = useLocation();
  const [anchorEl, setAnchorEl] = React.useState(null);
  const [createMenuAnchor, setCreateMenuAnchor] = React.useState(null);
  const [pasteDialogOpen, setPasteDialogOpen] = React.useState(false);
  const [uploadMode, setUploadMode] = React.useState('file');
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
    setUploadMode('file');
    setPasteDialogOpen(true);
  };

  const handleUploadDirectory = () => {
    handleCreateMenuClose();
    setUploadMode('folder');
    setPasteDialogOpen(true);
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
      const token = localStorage.getItem('token');
      const formData = new FormData();
      formData.append('file', file);
      await fetch('/api/upload', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`
        },
        body: formData
      });
      triggerRefresh();
    } catch (err) {
      console.error('上传失败:', err);
    }
  };

  const handleCreateFolderConfirm = async (folderPath) => {
    try {
      const token = localStorage.getItem('token');
      // 支持多级路径：按 / 拆分后逐级创建
      const segments = folderPath.split('/').filter(s => s.trim());
      let parentId = null;

      for (const segment of segments) {
        const res = await fetch('/api/directories', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({ name: segment.trim(), parent_id: parentId })
        });
        const data = await res.json();
        if (data.code === 0 && data.data) {
          // 创建成功，用返回的 id 作为下一级的 parent_id
          parentId = data.data.id;
        } else if (data.code === 409) {
          // 同名目录已存在，查询其 id 作为 parent_id 继续创建下一级
          const listRes = await fetch('/api/directories?type=flat', {
            headers: { 'Authorization': `Bearer ${token}` }
          });
          const listData = await listRes.json();
          if (listData.code === 0) {
            const existing = listData.data.find(d => d.name === segment.trim() && d.parent_id === parentId);
            if (existing) {
              parentId = existing.id;
              continue;
            }
          }
          console.error('创建文件夹失败:', data.message);
          break;
        } else {
          console.error('创建文件夹失败:', data.message);
          break;
        }
      }

      triggerRefresh();
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
        allowFolder={uploadMode === 'folder'}
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
