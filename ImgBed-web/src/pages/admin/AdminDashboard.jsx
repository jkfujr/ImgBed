import React from 'react';
import { Outlet, useNavigate, useLocation } from 'react-router-dom';
import { Box, Paper, Typography, Drawer, List, ListItem, ListItemButton, ListItemIcon, ListItemText, Divider } from '@mui/material';
import FolderIcon from '@mui/icons-material/Folder';
import SettingsIcon from '@mui/icons-material/Settings';

const drawerWidth = 240;

export default function AdminDashboard() {
  const navigate = useNavigate();
  const location = useLocation();

  const menuItems = [
    { text: '文件管理', icon: <FolderIcon />, path: '/admin/files' },
    { text: '系统配置', icon: <SettingsIcon />, path: '/admin/settings' },
  ];

  return (
    <Box sx={{ display: 'flex', height: '100%', flexGrow: 1, backgroundColor: 'background.default' }}>
      {/* 侧边大抽屉骨架 */}
      <Drawer
        variant="permanent"
        sx={{
          width: drawerWidth,
          flexShrink: 0,
          [`& .MuiDrawer-paper`]: { 
             width: drawerWidth, 
             boxSizing: 'border-box', 
             position: 'relative', 
             height: '100%',
             bgcolor: 'white',
             borderRight: '1px solid',
             borderColor: 'divider',
             zIndex: 1
          },
        }}
      >
        <Box sx={{ p: 2, textAlign: 'center' }}>
          <Typography variant="subtitle2" color="text.secondary" fontWeight="bold">
             管理后台
          </Typography>
        </Box>
        <Divider />
        <List>
          {menuItems.map((item) => {
            const isSelected = location.pathname.startsWith(item.path);
            return (
               <ListItem 
                   disablePadding
                   key={item.text} 
                   sx={{
                      mx: 1,
                      my: 0.5,
                      width: 'auto'
                   }}
               >
                 <ListItemButton
                   onClick={() => navigate(item.path)}
                   sx={{
                      borderRadius: 1,
                      bgcolor: isSelected ? 'primary.50' : 'transparent',
                      color: isSelected ? 'primary.main' : 'inherit',
                      '&:hover': { bgcolor: isSelected ? 'primary.100' : 'action.hover' },
                   }}
                 >
                   <ListItemIcon sx={{ color: isSelected ? 'primary.main' : 'inherit' }}>
                     {item.icon}
                   </ListItemIcon>
                   <ListItemText primary={item.text} primaryTypographyProps={{ fontWeight: isSelected ? 'bold' : 'normal' }} />
                 </ListItemButton>
               </ListItem>
            );
          })}
        </List>
      </Drawer>

      {/* 右侧工作台渲染主控 */}
      <Box component="main" sx={{ flexGrow: 1, p: 3, display: 'flex', flexDirection: 'column' }}>
          <Outlet />
      </Box>
    </Box>
  );
}
