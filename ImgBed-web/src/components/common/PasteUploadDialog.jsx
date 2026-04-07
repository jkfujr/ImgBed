import { useState, useRef, useEffect, useCallback } from 'react';
import {
  Dialog, DialogTitle, DialogContent, DialogActions,
  Button, Box, Typography, Alert, LinearProgress, ImageList, ImageListItem, IconButton,
  FormControl, InputLabel, Select, MenuItem, useTheme
} from '@mui/material';
import ContentPasteIcon from '@mui/icons-material/ContentPaste';
import CloseIcon from '@mui/icons-material/Close';
import { BORDER_RADIUS } from '../../utils/constants';
import { StorageDocs } from '../../api';
import logger from '../../utils/logger';

const DEFAULT_CHANNEL = '__system_default__';

export default function PasteUploadDialog({ open, onClose, onUpload, allowFolder = false }) {
  const theme = useTheme();
  const [files, setFiles] = useState([]);
  const [error, setError] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [selectedChannel, setSelectedChannel] = useState(DEFAULT_CHANNEL);
  const [availableChannels, setAvailableChannels] = useState([]);
  const [channelsLoading, setChannelsLoading] = useState(false);
  const [channelsError, setChannelsError] = useState(null);
  const boxRef = useRef(null);
  const fileInputRef = useRef(null);

  const resetState = useCallback(() => {
    setFiles([]);
    setError(null);
    setProgress(0);
    setSelectedChannel(DEFAULT_CHANNEL);
    setAvailableChannels([]);
    setChannelsError(null);
    setChannelsLoading(false);
  }, []);

  const loadChannels = useCallback(async () => {
    setChannelsLoading(true);
    setChannelsError(null);

    try {
      const res = await StorageDocs.list();
      if (res.code !== 0) {
        throw new Error(res.message || '获取上传渠道失败');
      }

      const writableChannels = (res.data?.list || []).filter((channel) => channel.enabled && channel.allowUpload);
      setAvailableChannels(writableChannels);
    } catch (err) {
      logger.error('获取上传渠道失败:', err);
      setAvailableChannels([]);
      setChannelsError(err.message || '获取上传渠道失败');
    } finally {
      setChannelsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!open) {
      resetState();
      return;
    }

    loadChannels();
  }, [open, loadChannels, resetState]);

  const handlePaste = (e) => {
    const items = e.clipboardData?.items;
    if (!items) return;

    const newFiles = [];
    for (let i = 0; i < items.length; i++) {
      if (items[i].type.indexOf('image') !== -1) {
        newFiles.push(items[i].getAsFile());
      }
    }

    if (newFiles.length > 0) {
      setFiles(prev => [...prev, ...newFiles]);
      setError(null);
    } else {
      setError('剪贴板中没有图片');
    }
  };

  const handleBoxClick = () => {
    fileInputRef.current?.click();
  };

  const handleFileSelect = (e) => {
    const selectedFiles = Array.from(e.target.files || []);
    if (selectedFiles.length > 0) {
      setFiles(prev => [...prev, ...selectedFiles]);
      setError(null);
    }
    e.target.value = null;
  };

  const removeFile = (index) => {
    setFiles(prev => prev.filter((_, i) => i !== index));
  };

  const handleConfirm = async () => {
    if (files.length === 0) return;

    setUploading(true);
    setProgress(0);

    const uploadOptions = selectedChannel === DEFAULT_CHANNEL ? {} : { channel: selectedChannel };

    try {
      for (let i = 0; i < files.length; i++) {
        await onUpload(files[i], uploadOptions);
        setProgress(((i + 1) / files.length) * 100);
      }
      handleClose();
    } catch (err) {
      setError('上传失败：' + (err.message || '未知错误'));
    } finally {
      setUploading(false);
    }
  };

  const handleClose = () => {
    if (!uploading) {
      resetState();
      onClose();
    }
  };

  return (
    <Dialog open={open} onClose={handleClose} maxWidth="md" fullWidth>
      <DialogTitle>上传图片</DialogTitle>
      <DialogContent>
        <FormControl fullWidth size="small" sx={{ mb: 2 }} disabled={uploading || channelsLoading}>
          <InputLabel>上传渠道</InputLabel>
          <Select
            value={selectedChannel}
            label="上传渠道"
            onChange={(e) => setSelectedChannel(e.target.value)}
          >
            <MenuItem value={DEFAULT_CHANNEL}>系统默认渠道</MenuItem>
            {availableChannels.map((channel) => (
              <MenuItem key={channel.id} value={channel.id}>
                {channel.name} ({channel.type})
              </MenuItem>
            ))}
          </Select>
        </FormControl>

        {channelsError && <Alert severity="warning" sx={{ mb: 2 }}>获取渠道列表失败，将使用系统默认渠道：{channelsError}</Alert>}

        <Box
          ref={boxRef}
          tabIndex={0}
          onPaste={handlePaste}
          onClick={handleBoxClick}
          sx={{
            border: '2px dashed',
            borderColor: files.length > 0 ? 'success.light' : 'primary.light',
            borderRadius: BORDER_RADIUS.md,
            p: 4,
            textAlign: 'center',
            bgcolor: theme.palette.mode === 'dark' ? 'background.paper' : 'grey.50',
            cursor: 'pointer',
            transition: 'all 0.2s',
            '&:hover': {
              borderColor: 'primary.main',
              bgcolor: theme.palette.mode === 'dark' ? 'action.hover' : 'grey.100'
            },
            '&:focus': { outline: 'none', borderColor: 'primary.main' }
          }}
        >
          <ContentPasteIcon sx={{ fontSize: 48, color: 'primary.light', mb: 1 }} />
          <Typography variant="body1" color="text.secondary">
            点击选择图片或按 Ctrl+V 粘贴
          </Typography>
          <Typography variant="caption" color="text.secondary" sx={{ mt: 0.5, display: 'block' }}>
            支持多选
          </Typography>
        </Box>

        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          multiple
          webkitdirectory={allowFolder ? '' : undefined}
          directory={allowFolder ? '' : undefined}
          style={{ display: 'none' }}
          onChange={handleFileSelect}
        />

        {error && <Alert severity="error" sx={{ mt: 2 }}>{error}</Alert>}

        {files.length > 0 && (
          <Box sx={{ mt: 2 }}>
            <Typography variant="body2" color="text.secondary" gutterBottom>
              已选择 {files.length} 个文件
            </Typography>
            <ImageList cols={4} gap={8} sx={{ maxHeight: 300, overflow: 'auto' }}>
              {files.map((file, index) => (
                <ImageListItem key={`${file.name}-${file.size}`} sx={{ position: 'relative' }}>
                  <img
                    src={URL.createObjectURL(file)}
                    alt={file.name}
                    loading="lazy"
                    style={{ height: 120, objectFit: 'cover', borderRadius: BORDER_RADIUS.sm }}
                  />
                  <IconButton
                    size="small"
                    onClick={() => removeFile(index)}
                    disabled={uploading}
                    sx={{
                      position: 'absolute',
                      top: 4,
                      right: 4,
                      bgcolor: 'rgba(0,0,0,0.6)',
                      color: 'white',
                      '&:hover': { bgcolor: 'rgba(0,0,0,0.8)' }
                    }}
                  >
                    <CloseIcon fontSize="small" />
                  </IconButton>
                </ImageListItem>
              ))}
            </ImageList>
          </Box>
        )}

        {uploading && (
          <Box sx={{ mt: 2 }}>
            <LinearProgress variant="determinate" value={progress} />
            <Typography variant="caption" color="text.secondary" sx={{ mt: 0.5, display: 'block', textAlign: 'center' }}>
              上传中... {Math.round(progress)}%
            </Typography>
          </Box>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={handleClose} disabled={uploading}>取消</Button>
        <Button variant="contained" onClick={handleConfirm} disabled={files.length === 0 || uploading}>
          上传 {files.length > 0 && `(${files.length})`}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
