import { useState, useEffect, useCallback } from 'react';
import {
  Alert, Button, CircularProgress, Dialog, DialogActions, DialogContent, DialogTitle, FormControl, InputLabel,
  LinearProgress, MenuItem, Select, Typography, Box
} from '@mui/material';
import { FileDocs, DirectoryDocs } from '../../api';
import logger from '../../utils/logger';
import { ROOT_DIR } from '../../admin/filesAdminShared';

export default function FilesAdminMoveDialog({ open, ids, currentDir, onClose, onSuccess }) {
  const [targetDirectory, setTargetDirectory] = useState(ROOT_DIR);
  const [availableDirectories, setAvailableDirectories] = useState([]);
  const [moving, setMoving] = useState(false);
  const [moveResult, setMoveResult] = useState(null);

  const fetchDirectories = useCallback(async () => {
    try {
      const res = await DirectoryDocs.list({ type: 'flat' });
      if (res.code === 0) {
        const dirs = res.data.list || res.data || [];
        setAvailableDirectories(dirs);
      }
    } catch (err) {
      logger.error('获取目录列表失败', err);
    }
  }, []);

  useEffect(() => {
    if (open) {
      fetchDirectories();
      setTargetDirectory(currentDir);
      setMoveResult(null);
    }
  }, [open, fetchDirectories, currentDir]);

  const handleConfirm = async () => {
    if (targetDirectory === undefined || ids.length === 0) return;
    setMoving(true);
    setMoveResult(null);
    try {
      const res = await FileDocs.batch({
        action: 'move',
        ids,
        target_directory: targetDirectory,
      });
      if (res.code === 0) {
        setMoveResult({ success: true, message: res.message });
        onSuccess?.();
      } else {
        setMoveResult({ success: false, message: res.message || '移动失败' });
      }
    } catch (e) {
      logger.error(e);
      setMoveResult({ success: false, message: '网络错误' });
    } finally {
      setMoving(false);
    }
  };

  const handleClose = () => {
    if (moving) return;
    onClose();
  };

  return (
    <Dialog open={open} onClose={handleClose} maxWidth="sm" fullWidth>
      <DialogTitle>移动文件</DialogTitle>
      <DialogContent dividers>
        <Typography gutterBottom>
          将 <b>{ids.length}</b> 个文件移动到指定目录：
        </Typography>
        <FormControl fullWidth size="small" sx={{ mt: 2 }}>
          <InputLabel>目标目录</InputLabel>
          <Select
            value={targetDirectory}
            label="目标目录"
            onChange={(e) => setTargetDirectory(e.target.value)}
            disabled={moving}
          >
            <MenuItem value={ROOT_DIR}>根目录 (/)</MenuItem>
            {availableDirectories.map((dir) => (
              <MenuItem key={dir.path} value={dir.path}>
                {dir.path}
              </MenuItem>
            ))}
          </Select>
        </FormControl>
        {moving && (
          <Box sx={{ mt: 2 }}>
            <LinearProgress />
            <Typography variant="caption" color="text.secondary" sx={{ mt: 0.5, display: 'block' }}>
              正在移动 {ids.length} 个文件...
            </Typography>
          </Box>
        )}
        {moveResult && !moving && (
          <Alert severity={moveResult.success ? 'success' : 'error'} sx={{ mt: 2 }}>
            {moveResult.message}
          </Alert>
        )}
        <Alert severity="info" sx={{ mt: 2 }}>
          移动操作仅修改文件的逻辑路径，不会改变物理存储位置。
        </Alert>
      </DialogContent>
      <DialogActions>
        <Button onClick={handleClose} disabled={moving}>
          {moveResult ? '关闭' : '取消'}
        </Button>
        {!moveResult && (
          <Button variant="contained" onClick={handleConfirm} disabled={moving || targetDirectory === undefined}>
            {moving ? <CircularProgress size={18} color="inherit" /> : '开始移动'}
          </Button>
        )}
      </DialogActions>
    </Dialog>
  );
}
