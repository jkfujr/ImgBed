import {
  Typography,
  Drawer,
  List,
  ListItem,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  Divider,
  IconButton,
  Tooltip,
  Box
} from '@mui/material';
import DashboardIcon from '@mui/icons-material/Dashboard';
import FolderIcon from '@mui/icons-material/Folder';
import SettingsIcon from '@mui/icons-material/Settings';
import StorageIcon from '@mui/icons-material/Storage';
import ChevronLeftIcon from '@mui/icons-material/ChevronLeft';
import ChevronRightIcon from '@mui/icons-material/ChevronRight';
import { BORDER_RADIUS } from '../../utils/constants';

// 常量移到单独文件以符合 fast refresh 要求
export const ADMIN_DRAWER_WIDTH = 240;
export const ADMIN_COLLAPSED_WIDTH = 56;

const ADMIN_MENU_ITEMS = [
  { text: '仪表盘', icon: <DashboardIcon />, path: '/admin/dashboard' },
  { text: '文件管理', icon: <FolderIcon />, path: '/admin/files' },
  { text: '存储渠道', icon: <StorageIcon />, path: '/admin/channels' },
  { text: '系统配置', icon: <SettingsIcon />, path: '/admin/system' },
];

export default function AdminSidebar({
  collapsed,
  currentPath,
  onToggleCollapse,
  onNavigate,
}) {
  const currentWidth = collapsed ? ADMIN_COLLAPSED_WIDTH : ADMIN_DRAWER_WIDTH;
  const headerJustifyContent = collapsed ? 'center' : 'space-between';
  const headerPaddingX = collapsed ? 0 : 2;

  return (
    <Drawer
      variant="permanent"
      sx={{
        width: currentWidth,
        flexShrink: 0,
        transition: 'width 0.2s',
        [`& .MuiDrawer-paper`]: {
          width: currentWidth,
          boxSizing: 'border-box',
          position: 'relative',
          height: '100%',
          overflow: 'hidden',
          bgcolor: 'white',
          borderRight: '1px solid',
          borderColor: 'divider',
          zIndex: 1,
          transition: 'width 0.2s',
        },
      }}
    >
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: headerJustifyContent, px: headerPaddingX, py: 1, minHeight: 48 }}>
        {!collapsed && (
          <Typography variant="subtitle2" color="text.secondary" fontWeight="bold">
            管理后台
          </Typography>
        )}
        <Tooltip title={collapsed ? '展开侧边栏' : '收起侧边栏'} placement="right">
          <IconButton size="small" onClick={onToggleCollapse}>
            {collapsed ? <ChevronRightIcon fontSize="small" /> : <ChevronLeftIcon fontSize="small" />}
          </IconButton>
        </Tooltip>
      </Box>
      <Divider />
      <List>
        {ADMIN_MENU_ITEMS.map((item) => {
          const isSelected = currentPath.startsWith(item.path);
          const itemJustifyContent = collapsed ? 'center' : 'flex-start';
          const itemPaddingX = collapsed ? 1 : 2;
          const itemBackgroundColor = isSelected ? 'primary.50' : 'transparent';
          const itemTextColor = isSelected ? 'primary.main' : 'inherit';
          const itemHoverBackgroundColor = isSelected ? 'primary.100' : 'action.hover';
          const itemIconMinWidth = collapsed ? 0 : 40;
          return (
            <ListItem
              disablePadding
              key={item.text}
              sx={{ mx: collapsed ? 0 : 1, my: 0.5, width: 'auto' }}
            >
              <Tooltip title={collapsed ? item.text : ''} placement="right">
                <ListItemButton
                  onClick={() => onNavigate(item.path)}
                  sx={{
                    borderRadius: BORDER_RADIUS.sm,
                    justifyContent: itemJustifyContent,
                    px: itemPaddingX,
                    bgcolor: itemBackgroundColor,
                    color: itemTextColor,
                    '&:hover': { bgcolor: itemHoverBackgroundColor },
                  }}
                >
                  <ListItemIcon sx={{ color: itemTextColor, minWidth: itemIconMinWidth }}>
                    {item.icon}
                  </ListItemIcon>
                  {!collapsed && (
                    <ListItemText
                      primary={item.text}
                      slotProps={{ primary: { fontWeight: isSelected ? 'bold' : 'normal' } }}
                    />
                  )}
                </ListItemButton>
              </Tooltip>
            </ListItem>
          );
        })}
      </List>
    </Drawer>
  );
}
