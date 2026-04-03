import React, { useState, useEffect, useCallback } from 'react';
import {
  Alert, Button, CircularProgress, Dialog, DialogActions, DialogContent, DialogTitle, FormControl, InputLabel,
  LinearProgress, MenuItem, Select, Typography, Box
} from '@mui/material';
import { FileDocs, StorageDocs } from '../../api';

export default function FilesAdminMigrateDialog({ open, ids, onClose, onSuccess }) {
  const [targetChannel, setTargetChannel] = useState('');
  const [availableChannels, setAvailableChannels] = useState([]);
  const [migrating, setMigrating] = useState(false);
  const [migrationResult, setMigrationResult] = useState(null);

  const fetchWritableChannels = useCallback(async () => {
    try {
      const res = await StorageDocs.list();
      if (res.code === 0) {
        const writable = (res.data.list || []).filter(
          (s) => s.enabled && s.allowUpload && ['local', 's3', 'huggingface'].includes(s.type)
        );
        setAvailableChannels(writable);
      }
    } catch (err) {
      console.error('获取可写入渠道失败', err);
    }
  }, []);

  // 打开对话框时加载可写入渠道并重置状态
  useEffect(() => {
    if (open) {
      fetchWritableChannels();
      setTargetChannel('');
      setMigrationResult(null);
    }
  }, [open, fetchWritableChannels]);

  const handleConfirm = async () => {
    if (!targetChannel || ids.length === 0) return;
    setMigrating(true);
    setMigrationResult(null);
    try {
      const res = await FileDocs.batch({
        action: 'migrate',
        ids,
        target_channel: targetChannel,
      });
      if (res.code === 0) {
        setMigrationResult(res.data);
        onSuccess?.();
      } else {
        setMigrationResult({ success: 0, failed: ids.length, skipped: 0, errors: [{ reason: res.message }] });
      }
    } catch (e) {
      console.error(e);
      setMigrationResult({ success: 0, failed: ids.length, skipped: 0, errors: [{ reason: '网络错误' }] });
    } finally {
      setMigrating(false);
    }
  };

  const handleClose = () => {
    if (migrating) return;
    onClose();
  };

  return (
    <Dialog open={open} onClose={handleClose} maxWidth="sm" fullWidth>
      <DialogTitle>迁移文件渠道</DialogTitle>
      <DialogContent dividers>
        <Typography gutterBottom>
          将 <b>{ids.length}</b> 个文件迁移到指定渠道：
        </Typography>
        <FormControl fullWidth size="small" sx={{ mt: 2 }}>
          <InputLabel>目标渠道</InputLabel>
          <Select value={targetChannel} label="目标渠道" onChange={(e) => setTargetChannel(e.target.value)} disabled={migrating}>
            {availableChannels.map((ch) => (
              <MenuItem key={ch.id} value={ch.id}>
                {ch.name} ({ch.type})
              </MenuItem>
            ))}
          </Select>
        </FormControl>
        {migrating && (
          <Box sx={{ mt: 2 }}>
            <LinearProgress />
            <Typography variant="caption" color="text.secondary" sx={{ mt: 0.5, display: 'block' }}>
              正在迁移 {ids.length} 个文件...
            </Typography>
          </Box>
        )}
        {migrationResult && !migrating && (
          <Alert severity={migrationResult.failed > 0 ? 'warning' : 'success'} sx={{ mt: 2 }}>
            成功: {migrationResult.success} | 失败: {migrationResult.failed} | 跳过: {migrationResult.skipped}
            {migrationResult.errors.length > 0 && (
              <Typography variant="caption" component="div" sx={{ mt: 1 }}>
                失败详情: {migrationResult.errors.map((e) => `${e.id}: ${e.reason}`).join(', ')}
              </Typography>
            )}
          </Alert>
        )}
        <Alert severity="info" sx={{ mt: 2 }}>
          迁移成功后源文件将保留作为备份，不会被删除。
        </Alert>
      </DialogContent>
      <DialogActions>
        <Button onClick={handleClose} disabled={migrating}>
          {migrationResult ? '关闭' : '取消'}
        </Button>
        {!migrationResult && (
          <Button variant="contained" onClick={handleConfirm} disabled={migrating || !targetChannel}>
            {migrating ? <CircularProgress size={18} color="inherit" /> : '开始迁移'}
          </Button>
        )}
      </DialogActions>
    </Dialog>
  );
}
