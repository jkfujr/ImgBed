import React, { useState, useRef } from 'react';
import {
  Dialog, DialogTitle, DialogContent, DialogActions,
  Button, Box, Typography, Alert
} from '@mui/material';
import ContentPasteIcon from '@mui/icons-material/ContentPaste';
import { BORDER_RADIUS } from '../../utils/constants';

export default function PasteUploadDialog({ open, onClose, onUpload }) {
  const [file, setFile] = useState(null);
  const [error, setError] = useState(null);
  const boxRef = useRef(null);

  const handlePaste = (e) => {
    const items = e.clipboardData?.items;
    if (!items) return;

    for (let i = 0; i < items.length; i++) {
      if (items[i].type.indexOf('image') !== -1) {
        const pastedFile = items[i].getAsFile();
        setFile(pastedFile);
        setError(null);
        return;
      }
    }
    setError('剪贴板中没有图片');
  };

  const handleConfirm = () => {
    if (file) {
      onUpload(file);
      handleClose();
    }
  };

  const handleClose = () => {
    setFile(null);
    setError(null);
    onClose();
  };

  return (
    <Dialog open={open} onClose={handleClose} maxWidth="sm" fullWidth>
      <DialogTitle>剪贴板上传</DialogTitle>
      <DialogContent>
        <Box
          ref={boxRef}
          tabIndex={0}
          onPaste={handlePaste}
          sx={{
            border: '2px dashed',
            borderColor: 'primary.light',
            borderRadius: BORDER_RADIUS.md,
            p: 4,
            textAlign: 'center',
            bgcolor: 'grey.50',
            cursor: 'text',
            '&:focus': { outline: 'none', borderColor: 'primary.main' }
          }}
        >
          <ContentPasteIcon sx={{ fontSize: 48, color: 'primary.light', mb: 1 }} />
          <Typography variant="body1" color="text.secondary">
            点击此处并按 Ctrl+V 粘贴图片
          </Typography>
        </Box>
        {error && <Alert severity="error" sx={{ mt: 2 }}>{error}</Alert>}
        {file && (
          <Box sx={{ mt: 2, textAlign: 'center' }}>
            <Typography variant="body2" color="success.main">
              已捕获图片：{file.name}
            </Typography>
            <Box
              component="img"
              src={URL.createObjectURL(file)}
              alt="预览"
              sx={{ mt: 1, maxWidth: '100%', maxHeight: 200, borderRadius: BORDER_RADIUS.sm }}
            />
          </Box>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={handleClose}>取消</Button>
        <Button variant="contained" onClick={handleConfirm} disabled={!file}>
          上传
        </Button>
      </DialogActions>
    </Dialog>
  );
}
