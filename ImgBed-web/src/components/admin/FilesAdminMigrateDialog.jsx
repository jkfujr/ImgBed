import React from 'react';
import {
  Alert, Button, CircularProgress, Dialog, DialogActions, DialogContent, DialogTitle, FormControl, InputLabel,
  LinearProgress, MenuItem, Select, Typography, Box
} from '@mui/material';

export default function FilesAdminMigrateDialog({
  open,
  migrating,
  targetChannel,
  availableChannels,
  ids,
  migrationResult,
  onClose,
  onTargetChannelChange,
  onConfirm,
}) {
  return (
    <Dialog open={open} onClose={() => !migrating && onClose()} maxWidth="sm" fullWidth>
      <DialogTitle>迁移文件渠道</DialogTitle>
      <DialogContent dividers>
        <Typography gutterBottom>
          将 <b>{ids.length}</b> 个文件迁移到指定渠道：
        </Typography>
        <FormControl fullWidth size="small" sx={{ mt: 2 }}>
          <InputLabel>目标渠道</InputLabel>
          <Select value={targetChannel} label="目标渠道" onChange={onTargetChannelChange} disabled={migrating}>
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
        <Button onClick={onClose} disabled={migrating}>
          {migrationResult ? '关闭' : '取消'}
        </Button>
        {!migrationResult && (
          <Button variant="contained" onClick={onConfirm} disabled={migrating || !targetChannel}>
            {migrating ? <CircularProgress size={18} color="inherit" /> : '开始迁移'}
          </Button>
        )}
      </DialogActions>
    </Dialog>
  );
}
