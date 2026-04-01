import React, { useState, useEffect, useCallback } from 'react';
import {
  Box, Typography, Grid, Card, CardContent, CardActions,
  IconButton, Chip, Tooltip, CircularProgress, Alert,
  Divider, LinearProgress,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
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
import { api, StorageDocs } from '../../api';

export default function StorageChannelsPage() {
  const [storages, setStorages] = useState([]);
  const [defaultId, setDefaultId] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [quotaStats, setQuotaStats] = useState({});
  const [stats, setStats] = useState(null);

  // 弹窗状态
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editTarget, setEditTarget] = useState(null);

  // 删除确认弹窗
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [deleting, setDeleting] = useState(false);

  const loadStorages = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      // 并行请求：渠道列表 + 容量统计 + 统计信息，减少总加载时间
      const [listRes, quotaRes, statsRes] = await Promise.all([
        StorageDocs.list(),
        api.get('/api/system/quota-stats').catch(() => ({ code: -1, data: { stats: {} } })),
        StorageDocs.stats().catch(() => ({ code: -1, data: null }))
      ]);

      if (listRes.code === 0) {
        setStorages(listRes.data.list || []);
        setDefaultId(listRes.data.default || '');
      } else {
        setError(listRes.message || '加载失败');
      }

      if (quotaRes.code === 0 && quotaRes.data) {
        setQuotaStats(quotaRes.data.stats || {});
      }

      if (statsRes.code === 0 && statsRes.data) {
        setStats(statsRes.data);
      }
    } catch {
      setError('网络错误，请检查后端服务');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadStorages(); }, [loadStorages]);

  // 打开编辑弹窗
  const openEdit = (s) => {
    setEditTarget(s);
    setDialogOpen(true);
  };

  const closeDialog = () => {
    setDialogOpen(false);
    setEditTarget(null);
  };

  // 启用/禁用切换
  const handleToggle = async (s) => {
    try {
      const res = await StorageDocs.toggle(s.id);
      if (res.code === 0) loadStorages();
    } catch { /* 忽略 */ }
  };

  // 设为默认
  const handleSetDefault = async (id) => {
    try {
      const res = await StorageDocs.setDefault(id);
      if (res.code === 0) loadStorages();
    } catch { /* 忽略 */ }
  };

  // 确认删除
  const handleDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      const res = await StorageDocs.remove(deleteTarget.id);
      if (res.code === 0) {
        setDeleteTarget(null);
        loadStorages();
      }
    } catch { /* 忽略 */ } finally {
      setDeleting(false);
    }
  };

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

      {error && <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>{error}</Alert>}

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
                {/* 分组标题 */}
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

                          {/* 容量进度条 - 仅在启用容量限制时显示 */}
                          {(() => {
                            const quotaLimitGB = s.quotaLimitGB;
                            if (!quotaLimitGB || quotaLimitGB <= 0) return null;

                            const usedBytes = quotaStats[s.id] || 0;
                            const usedGB = bytesToGB(usedBytes);
                            const percent = calculateQuotaPercent(usedBytes, quotaLimitGB);
                            const thresholdPercent = s.disableThresholdPercent ?? 95;
                            const isOverThreshold = percent >= thresholdPercent;

                            // 根据百分比选颜色
                            let color = 'primary';
                            if (percent >= thresholdPercent) {
                              color = 'error';
                            } else if (percent > 70) {
                              color = 'warning';
                            }

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
                          })()}
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

      {/* 新增/编辑弹窗 */}
      <ChannelDialog
        open={dialogOpen}
        onClose={closeDialog}
        editTarget={editTarget}
        onSuccess={() => {
          closeDialog();
          loadStorages();
        }}
      />

      {/* 删除确认弹窗 */}
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


