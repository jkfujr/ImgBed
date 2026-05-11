import { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Button,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControl,
  InputLabel,
  MenuItem,
  Select,
  Typography,
} from '@mui/material';
import { StorageDocs } from '../../api';
import logger from '../../utils/logger';
import { WRITABLE_STORAGE_TYPES } from '../../utils/storageTypes';

export default function ChannelMigrationDialog({
  open,
  sourceChannel,
  storages = [],
  onClose,
  onStarted,
}) {
  const [targetChannel, setTargetChannel] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  const availableTargets = useMemo(() => storages.filter((storage) => (
    storage.id !== sourceChannel?.id
    && storage.enabled
    && storage.allowUpload
    && WRITABLE_STORAGE_TYPES.has(storage.type)
  )), [sourceChannel, storages]);

  useEffect(() => {
    if (open) {
      setTargetChannel('');
      setSaving(false);
      setError(null);
    }
  }, [open]);

  const handleClose = () => {
    if (saving) return;
    onClose();
  };

  const handleConfirm = async () => {
    if (!sourceChannel || !targetChannel) return;
    setSaving(true);
    setError(null);
    try {
      const res = await StorageDocs.migrate(sourceChannel.id, {
        target_channel: targetChannel,
      });

      if (res.code === 0) {
        onStarted?.(res.data);
        return;
      }

      setError(res.message || '启动迁移失败');
    } catch (err) {
      logger.error('启动渠道迁移失败', err);
      setError(err.response?.data?.message || err.message || '网络错误');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onClose={handleClose} maxWidth="sm" fullWidth>
      <DialogTitle>迁移渠道：{sourceChannel?.name || sourceChannel?.id}</DialogTitle>
      <DialogContent dividers>
        {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
        <Typography variant="body2" color="text.secondary" gutterBottom>
          将该渠道在数据库中的所有 active 文件迁移到目标渠道。源渠道远端文件会保留，数据库索引会指向目标渠道。
        </Typography>
        <FormControl fullWidth size="small" sx={{ mt: 2 }}>
          <InputLabel>目标存储渠道</InputLabel>
          <Select
            value={targetChannel}
            label="目标存储渠道"
            onChange={(event) => setTargetChannel(event.target.value)}
            disabled={saving}
          >
            {availableTargets.map((channel) => (
              <MenuItem key={channel.id} value={channel.id}>
                {channel.name} ({channel.id} / {channel.type})
              </MenuItem>
            ))}
          </Select>
        </FormControl>
        {availableTargets.length === 0 && (
          <Alert severity="warning" sx={{ mt: 2 }}>
            暂无可写入的目标渠道。
          </Alert>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={handleClose} disabled={saving}>取消</Button>
        <Button
          variant="contained"
          onClick={handleConfirm}
          disabled={saving || !targetChannel}
        >
          {saving ? <CircularProgress size={18} color="inherit" /> : '启动迁移'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
