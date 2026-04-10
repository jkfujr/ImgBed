import { useState } from 'react';
import { Button, Menu, MenuItem, ListItemIcon, Divider } from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import ImageIcon from '@mui/icons-material/Image';
import FolderIcon from '@mui/icons-material/Folder';
import ContentPasteIcon from '@mui/icons-material/ContentPaste';
import CreateNewFolderIcon from '@mui/icons-material/CreateNewFolder';
import StorageIcon from '@mui/icons-material/Storage';
import { BORDER_RADIUS } from '../../utils/constants';
import logger from '../../utils/logger';
import PasteUploadDialog from '../common/PasteUploadDialog';
import CreateFolderDialog from '../common/CreateFolderDialog';
import ChannelDialog from '../common/ChannelDialog';
import { useRefresh } from '../../contexts/RefreshContext';
import { useUpload } from '../../hooks/useUpload';
import { useCreateDirectory } from '../../hooks/useCreateDirectory';
import { normalizeDirectoryPath, ROOT_DIR } from '../../admin/filesAdminShared';

export default function CreateActionButton({ currentDir = ROOT_DIR }) {
  const { triggerRefresh } = useRefresh();
  const { upload } = useUpload({ refreshMode: 'global' });
  const { createDirectory } = useCreateDirectory();
  const [createMenuAnchor, setCreateMenuAnchor] = useState(null);
  const [pasteDialogOpen, setPasteDialogOpen] = useState(false);
  const [uploadMode, setUploadMode] = useState('file');
  const [folderDialogOpen, setFolderDialogOpen] = useState(false);
  const [channelDialogOpen, setChannelDialogOpen] = useState(false);
  const resolvedDir = normalizeDirectoryPath(currentDir);

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
    setUploadMode('file');
    setPasteDialogOpen(true);
  };

  const handleCreateFolder = () => {
    handleCreateMenuClose();
    setFolderDialogOpen(true);
  };

  const handlePasteUploadFile = async (file, options = {}) => {
    try {
      const result = await upload(file, { ...options, directory: resolvedDir });
      if (!result.success) {
        logger.error('上传失败:', result.error);
      }
    } catch (err) {
      logger.error('上传失败:', err);
    }
  };

  const handleCreateFolderConfirm = async (folderPath) => {
    try {
      const createOptions = resolvedDir === ROOT_DIR
        ? { parentId: null }
        : { currentPath: resolvedDir };
      const result = await createDirectory(folderPath, createOptions);
      if (!result.success) {
        logger.error('创建文件夹失败:', result.error);
      }
      triggerRefresh();
    } catch (err) {
      logger.error('创建文件夹失败:', err);
    }
  };

  const handleAddChannel = () => {
    handleCreateMenuClose();
    setChannelDialogOpen(true);
  };

  return (
    <>
      <Button
        variant="contained"
        color="primary"
        startIcon={<AddIcon />}
        onClick={handleCreateMenuOpen}
        sx={{ borderRadius: BORDER_RADIUS.md, ml: 2 }}
      >
        新建
      </Button>

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

      <PasteUploadDialog
        open={pasteDialogOpen}
        onClose={() => setPasteDialogOpen(false)}
        onUpload={handlePasteUploadFile}
        allowFolder={uploadMode === 'folder'}
      />

      <CreateFolderDialog
        open={folderDialogOpen}
        onClose={() => setFolderDialogOpen(false)}
        onConfirm={handleCreateFolderConfirm}
      />

      <ChannelDialog
        open={channelDialogOpen}
        onClose={() => setChannelDialogOpen(false)}
        editTarget={null}
        onSuccess={() => setChannelDialogOpen(false)}
      />
    </>
  );
}
