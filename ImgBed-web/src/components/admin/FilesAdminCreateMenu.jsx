import React from 'react';
import { Divider, ListItemIcon, Menu, MenuItem } from '@mui/material';
import FolderIcon from '@mui/icons-material/Folder';
import ImageIcon from '@mui/icons-material/Image';
import ContentPasteIcon from '@mui/icons-material/ContentPaste';
import CreateNewFolderIcon from '@mui/icons-material/CreateNewFolder';
import StorageIcon from '@mui/icons-material/Storage';
import { BORDER_RADIUS } from '../../utils/constants';

export default function FilesAdminCreateMenu({
  anchorEl,
  open,
  onClose,
  onUploadImage,
  onUploadDirectory,
  onOpenPasteUpload,
  onOpenCreateFolder,
  onGoStorageChannels,
}) {
  const runAction = (action) => {
    onClose();
    action();
  };

  return (
    <Menu
      anchorEl={anchorEl}
      open={open}
      onClose={onClose}
      transformOrigin={{ horizontal: 'left', vertical: 'top' }}
      anchorOrigin={{ horizontal: 'left', vertical: 'bottom' }}
      slotProps={{
        paper: {
          elevation: 3,
          sx: { mt: 1, minWidth: 180, borderRadius: BORDER_RADIUS.md },
        },
      }}
    >
      <MenuItem onClick={() => runAction(onUploadImage)}>
        <ListItemIcon><ImageIcon fontSize="small" /></ListItemIcon>
        上传图片
      </MenuItem>
      <MenuItem onClick={() => runAction(onUploadDirectory)}>
        <ListItemIcon><FolderIcon fontSize="small" /></ListItemIcon>
        上传目录
      </MenuItem>
      <MenuItem onClick={() => runAction(onOpenPasteUpload)}>
        <ListItemIcon><ContentPasteIcon fontSize="small" /></ListItemIcon>
        剪贴板上传
      </MenuItem>
      <Divider />
      <MenuItem onClick={() => runAction(onOpenCreateFolder)}>
        <ListItemIcon><CreateNewFolderIcon fontSize="small" /></ListItemIcon>
        创建文件夹
      </MenuItem>
      <MenuItem onClick={() => runAction(onGoStorageChannels)}>
        <ListItemIcon><StorageIcon fontSize="small" /></ListItemIcon>
        新增渠道
      </MenuItem>
    </Menu>
  );
}
