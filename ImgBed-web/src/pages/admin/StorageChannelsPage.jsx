import {
  Box, Typography, Grid, Card, CardContent, CardActions,
  IconButton, Chip, Tooltip, CircularProgress, Alert,
  Divider, LinearProgress,
} from '@mui/material';
import RefreshIcon from '@mui/icons-material/Refresh';
import EditIcon from '@mui/icons-material/Edit';
import DeleteIcon from '@mui/icons-material/Delete';
import StarIcon from '@mui/icons-material/Star';
import StarBorderIcon from '@mui/icons-material/StarBorder';
import VisibilityIcon from '@mui/icons-material/Visibility';
import VisibilityOffIcon from '@mui/icons-material/VisibilityOff';
import ConfirmDialog from '../../components/common/ConfirmDialog';
import ChannelDialog from '../../components/common/ChannelDialog';
import { TYPE_COLORS, VALID_TYPES, BORDER_RADIUS } from '../../utils/constants';
import { bytesToGB, calculateQuotaPercent } from '../../utils/formatters';
import { useStorageChannels } from '../../hooks/useStorageChannels';

/** 渠道卡片内的容量进度条 */
function QuotaBar({ storage, quotaStats }) {
  const quotaLimitGB = storage.quotaLimitGB;
  if (!quotaLimitGB || quotaLimitGB <= 0) return null;

  const usedBytes = quotaStats[storage.id] || 0;
  const usedGB = bytesToGB(usedBytes);
  const percent = calculateQuotaPercent(usedBytes, quotaLimitGB);
  const thresholdPercent = storage.disableThresholdPercent ?? 95;
  const isOverThreshold = percent >= thresholdPercent;

  let color = 'primary';
  if (percent >= thresholdPercent) color = 'error';
  else if (percent > 70) color = 'warning';

  return (
    <Box sx={{ mt: 2 }}>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 0.5 }}>
        <Typography variant="caption" color="text.secondary">
          {usedGB.toFixed(2)} GB / {quotaLimitGB} GB
        </Typography>
        <Typography variant="caption" color={isOverThreshold ? 'error' : 'text.secondary'}>
          {percent.toFixed(1)}%
        </Typography>
      </Box>
      <LinearProgress
        variant="determinate"
        value={percent}
        color={color}
        sx={{ height: 8, borderRadius: BORDER_RADIUS.sm }}
      />
      {isOverThreshold && (
        <Typography variant="caption" color="error" sx={{ display: 'block', mt: 0.5 }}>
          已达到停用阈值，上传将被自动禁用
        </Typography>
      )}
    </Box>
  );
}

export default function StorageChannelsPage() {
  const {
    storages, defaultId, loading, error, quotaStats, stats,
    dialogOpen, editTarget, deleteTarget, deleting,
    loadStorages, openEdit, closeDialog,
    handleToggle, handleSetDefault, handleDelete,
    setDeleteTarget, clearError, onDialogSuccess,
  } = useStorageChannels();

  return (
    <Box>
      {/* 统计信息栏 */}
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 3 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          {stats && (
            <>
              <Chip label={`共 ${stats.total} 个渠道`} size="small" variant="outlined" />
              <Chip label={`${stats.enabled} 个已启用`} size="small" color="success" />
              <Chip label={`${stats.allowUpload} 个允许上传`} size="small" color="primary" />
            </>
          )}
        </Box>
        <Tooltip title="刷新列表">
          <span>
            <IconButton size="small" onClick={loadStorages} disabled={loading}>
              <RefreshIcon fontSize="small" />
            </IconButton>
          </span>
        </Tooltip>
      </Box>

      {error && <Alert severity="error" sx={{ mb: 2 }} onClose={clearError}>{error}</Alert>}

      {loading ? (
        <Box display="flex" justifyContent="center" pt={6}><CircularProgress /></Box>
      ) : storages.length === 0 ? (
        <Typography color="text.secondary" textAlign="center" pt={6}>暂无存储渠道，点击「新增渠道」添加</Typography>
      ) : (
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
          {VALID_TYPES.filter((type) => storages.some((s) => s.type === type)).map((type) => {
            const group = storages.filter((s) => s.type === type);
            return (
              <Box key={type}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1.5 }}>
                  <Chip label={type} size="small" color={TYPE_COLORS[type] || 'default'} />
                  <Typography variant="body2" color="text.secondary">{group.length} 个渠道</Typography>
                  <Divider sx={{ flex: 1 }} />
                </Box>
                <Grid container spacing={2}>
                  {group.map((s) => (
                    <Grid size={{ xs: 12, sm: 6, md: 4 }} key={s.id}>
                      <Card variant="outlined" sx={{ borderRadius: BORDER_RADIUS.md, height: '100%', display: 'flex', flexDirection: 'column' }}>
                        <CardContent sx={{ flexGrow: 1 }}>
                          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1, flexWrap: 'wrap' }}>
                            {s.id === defaultId && (
                              <Chip label="默认" size="small" color="warning" variant="outlined" />
                            )}
                            <Box sx={{ ml: 'auto', width: 10, height: 10, borderRadius: '50%',
                              bgcolor: s.enabled ? 'success.main' : 'action.disabled' }} />
                          </Box>
                          <Typography variant="subtitle1" fontWeight="bold" noWrap>{s.name}</Typography>
                          <Typography variant="body2" color="text.secondary" noWrap>ID：{s.id}</Typography>
                          <Box sx={{ display: 'flex', gap: 0.5, mt: 1, flexWrap: 'wrap' }}>
                            <Chip label={s.enabled ? '已启用' : '已禁用'} size="small"
                              color={s.enabled ? 'success' : 'default'} variant="outlined" />
                            {s.allowUpload && <Chip label="允许上传" size="small" color="primary" variant="outlined" />}
                          </Box>
                          <QuotaBar storage={s} quotaStats={quotaStats} />
                        </CardContent>
                        <Divider />
                        <CardActions sx={{ px: 1.5, py: 0.5 }}>
                          <Tooltip title={s.id === defaultId ? '当前默认渠道' : '设为默认渠道'}>
                            <span>
                              <IconButton size="small" onClick={() => handleSetDefault(s.id)}
                                color={s.id === defaultId ? 'warning' : 'default'}
                                disabled={s.id === defaultId}>
                                {s.id === defaultId ? <StarIcon fontSize="small" /> : <StarBorderIcon fontSize="small" />}
                              </IconButton>
                            </span>
                          </Tooltip>
                          <Tooltip title="编辑">
                            <IconButton size="small" onClick={() => openEdit(s)}><EditIcon fontSize="small" /></IconButton>
                          </Tooltip>
                          <Tooltip title={s.enabled ? '禁用' : '启用'}>
                            <IconButton size="small" onClick={() => handleToggle(s)}
                              color={s.enabled ? 'warning' : 'success'}>
                              {s.enabled ? <VisibilityOffIcon fontSize="small" /> : <VisibilityIcon fontSize="small" />}
                            </IconButton>
                          </Tooltip>
                          <Tooltip title={s.id === defaultId ? '默认渠道不可删除' : '删除'}>
                            <span>
                              <IconButton size="small" color="error"
                                disabled={s.id === defaultId}
                                onClick={() => setDeleteTarget(s)}>
                                <DeleteIcon fontSize="small" />
                              </IconButton>
                            </span>
                          </Tooltip>
                        </CardActions>
                      </Card>
                    </Grid>
                  ))}
                </Grid>
              </Box>
            );
          })}
        </Box>
      )}

      <ChannelDialog
        open={dialogOpen}
        onClose={closeDialog}
        editTarget={editTarget}
        onSuccess={onDialogSuccess}
      />

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        title="确认删除"
        onClose={() => setDeleteTarget(null)}
        onConfirm={handleDelete}
        confirmLoading={deleting}
        confirmText="确认删除"
      >
        确定要删除渠道「{deleteTarget?.name}」（{deleteTarget?.id}）吗？此操作不可撤销。
      </ConfirmDialog>
    </Box>
  );
}
