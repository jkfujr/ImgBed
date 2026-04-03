import { useState } from 'react';
import {
  Dialog, DialogTitle, DialogContent, DialogActions,
  Button, TextField, Alert
} from '@mui/material';

export default function CreateFolderDialog({ open, onClose, onConfirm }) {
  const [folderName, setFolderName] = useState('');
  const [error, setError] = useState(null);

  const handleConfirm = () => {
    const trimmed = folderName.trim();
    if (!trimmed) {
      setError('文件夹名称不能为空');
      return;
    }
    if (trimmed.includes('..') || trimmed.includes('\\')) {
      setError('文件夹名称包含非法字符');
      return;
    }
    onConfirm(trimmed);
    handleClose();
  };

  const handleClose = () => {
    setFolderName('');
    setError(null);
    onClose();
  };

  return (
    <Dialog open={open} onClose={handleClose} maxWidth="sm" fullWidth>
      <DialogTitle>创建文件夹</DialogTitle>
      <DialogContent>
        {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
        <TextField
          autoFocus
          fullWidth
          label="文件夹名称"
          value={folderName}
          onChange={(e) => setFolderName(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleConfirm()}
          placeholder="例如：photos/2024"
          helperText="支持多级路径，使用 / 分隔"
        />
      </DialogContent>
      <DialogActions>
        <Button onClick={handleClose}>取消</Button>
        <Button variant="contained" onClick={handleConfirm}>
          创建
        </Button>
      </DialogActions>
    </Dialog>
  );
}
