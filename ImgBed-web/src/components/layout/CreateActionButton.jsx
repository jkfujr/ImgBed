import { useRef, useState } from 'react';
import { Button, Menu, MenuItem, ListItemIcon, Divider } from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import ImageIcon from '@mui/icons-material/Image';
import FolderIcon from '@mui/icons-material/Folder';
import ContentPasteIcon from '@mui/icons-material/ContentPaste';
import CreateNewFolderIcon from '@mui/icons-material/CreateNewFolder';
import StorageIcon from '@mui/icons-material/Storage';
import { BORDER_RADIUS } from '../../utils/constants';
import logger from '../../utils/logger';
import { createOverlayFocusManager } from '../../utils/overlay-focus';
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
  const overlayFocusManagerRef = useRef(null);
  const resolvedDir = normalizeDirectoryPath(currentDir);

  if (!overlayFocusManagerRef.current) {
    overlayFocusManagerRef.current = createOverlayFocusManager();
  }

  const overlayFocusManager = overlayFocusManagerRef.current;

  const handleCreateMenuOpen = (event) => {
    setCreateMenuAnchor(event.currentTarget);
  };

  const handleCreateMenuClose = () => {
    setCreateMenuAnchor(null);
  };

  const queueMenuDialogOpen = (openOverlay) => {
    overlayFocusManager.queueMenuAction({
      restoreTarget: createMenuAnchor,
      closeMenu: handleCreateMenuClose,
      openOverlay,
    });
  };

  const handleUploadImage = () => {
    setUploadMode('file');
    queueMenuDialogOpen(() => setPasteDialogOpen(true));
  };

  const handleUploadDirectory = () => {
    setUploadMode('folder');
    queueMenuDialogOpen(() => setPasteDialogOpen(true));
  };

  const handlePasteUpload = () => {
    setUploadMode('file');
    queueMenuDialogOpen(() => setPasteDialogOpen(true));
  };

  const handleCreateFolder = () => {
    queueMenuDialogOpen(() => setFolderDialogOpen(true));
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
    queueMenuDialogOpen(() => setChannelDialogOpen(true));
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
        slotProps={{
          paper: {
            elevation: 3,
            sx: { mt: 1, minWidth: 180, borderRadius: BORDER_RADIUS.md },
          },
          transition: {
            onExited: () => overlayFocusManager.flushPendingMenuAction(),
          },
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
        onClose={() => overlayFocusManager.close(() => setPasteDialogOpen(false))}
        onUpload={handlePasteUploadFile}
        allowFolder={uploadMode === 'folder'}
      />

      <CreateFolderDialog
        open={folderDialogOpen}
        onClose={() => overlayFocusManager.close(() => setFolderDialogOpen(false))}
        onConfirm={handleCreateFolderConfirm}
      />

      <ChannelDialog
        open={channelDialogOpen}
        onClose={() => overlayFocusManager.close(() => setChannelDialogOpen(false))}
        editTarget={null}
        onSuccess={() => {}}
      />
    </>
  );
}
