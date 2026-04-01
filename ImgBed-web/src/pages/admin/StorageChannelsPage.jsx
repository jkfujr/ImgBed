import React, { useState, useEffect, useCallback } from 'react';
import {
  Box, Typography, Grid, Card, CardContent, CardActions,
  Button, IconButton, Chip, Tooltip, CircularProgress, Alert,
  Dialog, DialogTitle, DialogContent, DialogActions,
  TextField, FormControlLabel, Switch, FormControl,
  InputLabel, Select, MenuItem, InputAdornment, Divider,
  LinearProgress,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import RefreshIcon from '@mui/icons-material/Refresh';
import EditIcon from '@mui/icons-material/Edit';
import DeleteIcon from '@mui/icons-material/Delete';
import StarIcon from '@mui/icons-material/Star';
import StarBorderIcon from '@mui/icons-material/StarBorder';
import VisibilityIcon from '@mui/icons-material/Visibility';
import VisibilityOffIcon from '@mui/icons-material/VisibilityOff';
import { StorageDocs } from '../../api';

// 各存储类型的 config 字段定义
const CHANNEL_SCHEMAS = {
  local: [
    { key: 'basePath', label: '本地路径', required: true },
  ],
  s3: [
    { key: 'bucket',          label: 'Bucket 名称',    required: true },
    { key: 'region',          label: 'Region',          required: true },
    { key: 'accessKeyId',     label: 'Access Key ID',   required: true },
    { key: 'secretAccessKey', label: 'Secret Access Key', required: true, sensitive: true },
    { key: 'endpoint',        label: 'Endpoint（自定义）' },
    { key: 'pathPrefix',      label: '路径前缀' },
    { key: 'publicUrl',       label: '公共访问 URL' },
  ],
  telegram: [
    { key: 'botToken', label: 'Bot Token', required: true, sensitive: true },
    { key: 'chatId',   label: 'Chat ID',   required: true },
    { key: 'proxyUrl', label: '代理地址' },
  ],
  discord: [
    { key: 'webhookUrl', label: 'Webhook URL', required: true, sensitive: true },
    { key: 'channelId',  label: 'Channel ID' },
  ],
  huggingface: [
    { key: 'repo',       label: '仓库名（user/repo）', required: true },
    { key: 'token',      label: 'API Token',            required: true, sensitive: true },
    { key: 'pathPrefix', label: '路径前缀' },
    { key: 'branch',     label: '分支（默认 main）' },
  ],
  external: [
    { key: 'baseUrl',    label: '基础 URL', required: true },
    { key: 'authHeader', label: '认证 Header', sensitive: true },
  ],
};

// 渠道类型的显示颜色
const TYPE_COLORS = {
  local:       'default',
  s3:          'primary',
  telegram:    'info',
  discord:     'secondary',
  huggingface: 'warning',
  external:    'success',
};

const VALID_TYPES = Object.keys(CHANNEL_SCHEMAS);

// 通用字段初始值
const EMPTY_FORM = {
  id: '', type: 'local', name: '', enabled: true, allowUpload: false,
  weight: 1,
  enableQuota: false,        // 是否启用容量限制，默认不开启
  quotaLimitGB: 10,          // 容量上限 GB，默认 10
  disableThresholdPercent: 95, // 停用阈值 %，默认 95
  config: {},
};
export default function StorageChannelsPage() {
  const [storages, setStorages] = useState([]);
  const [defaultId, setDefaultId] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [quotaStats, setQuotaStats] = useState({}); // 容量统计 { channelId: usedBytes }

  // 弹窗状态
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editTarget, setEditTarget] = useState(null); // null = 新增，对象 = 编辑
  const [step, setStep] = useState(0); // 0=选类型 1=通用字段 2=config字段
  const [form, setForm] = useState(EMPTY_FORM);
  const [showSensitive, setShowSensitive] = useState({});
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState(null);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState(null);

  // 删除确认弹窗
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [deleting, setDeleting] = useState(false);

  const loadStorages = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await StorageDocs.list();
      let storagesData = [];
      let defaultData = '';
      if (res.code === 0) {
        storagesData = res.data.list || [];
        defaultData = res.data.default || '';
      } else {
        setError(res.message || '加载失败');
      }

      // 加载容量统计 - 先等统计完成再一起更新状态
      // 这样启用容量限制后能立即显示正确的容量
      try {
        const quotaRes = await fetch('/api/system/quota-stats');
        const quotaData = await quotaRes.json();
        if (quotaData.code === 0) {
          setQuotaStats(quotaData.data.stats || {});
        }
      } catch (e) {
        console.warn('加载容量统计失败:', e);
      }

      // 一起更新渠道列表，确保渲染时就能拿到最新的quotaStats
      if (res.code === 0) {
        setStorages(storagesData);
        setDefaultId(defaultData);
      }
    } catch {
      setError('网络错误，请检查后端服务');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadStorages(); }, [loadStorages]);

  // 打开新增弹窗
  const openCreate = () => {
    setEditTarget(null);
    setForm(EMPTY_FORM);
    setStep(0);
    setShowSensitive({});
    setFormError(null);
    setDialogOpen(true);
  };

  // 打开编辑弹窗
  const openEdit = (s) => {
    setEditTarget(s);
    // 敏感字段替换为空字符串，让用户决定是否重新输入
    const editConfig = {};
    for (const [k, v] of Object.entries(s.config || {})) {
      editConfig[k] = v === '***' ? '' : v;
    }
    setForm({
      id: s.id, type: s.type, name: s.name,
      enabled: s.enabled, allowUpload: s.allowUpload,
      weight: s.weight || 1,
      // 加载配额字段 - 有值且大于0则开启
      enableQuota: s.quotaLimitGB != null && s.quotaLimitGB > 0,
      quotaLimitGB: s.quotaLimitGB ?? 10,
      disableThresholdPercent: s.disableThresholdPercent ?? 95,
      config: editConfig
    });
    setStep(1); // 编辑时跳过类型选择步骤
    setShowSensitive({});
    setFormError(null);
    setDialogOpen(true);
  };

  const closeDialog = () => { setDialogOpen(false); setFormError(null); setTestResult(null); };

  // 表单字段更新
  const setField = (key, val) => setForm((f) => ({ ...f, [key]: val }));
  const setConfigField = (key, val) => setForm((f) => ({ ...f, config: { ...f.config, [key]: val } }));

  // 提交新增或编辑
  const handleSubmit = async () => {
    setFormError(null);
    setSaving(true);
    try {
      // 构建 config payload：敏感字段为空字符串时传 null（后端跳过覆盖）
      const configPayload = {};
      const schema = CHANNEL_SCHEMAS[form.type] || [];
      for (const field of schema) {
        const val = form.config[field.key];
        if (field.sensitive && (val === '' || val === undefined)) {
          configPayload[field.key] = null;
        } else if (val !== undefined && val !== '') {
          configPayload[field.key] = val;
        }
      }

      const payload = {
        name: form.name,
        enabled: form.enabled,
        allowUpload: form.allowUpload,
        weight: form.weight ?? 1,
        // 配额字段
        enableQuota: form.enableQuota,
        quotaLimitGB: form.quotaLimitGB,
        disableThresholdPercent: form.disableThresholdPercent,
        config: configPayload,
      };

      let res;
      if (editTarget) {
        res = await StorageDocs.update(form.id, payload);
      } else {
        res = await StorageDocs.create({ ...payload, id: form.id, type: form.type });
      }

      if (res.code === 0) {
        closeDialog();
        loadStorages();
      } else {
        setFormError(res.message || '保存失败');
      }
    } catch (e) {
      setFormError(e.response?.data?.message || '网络错误');
    } finally {
      setSaving(false);
    }
  };

  // 测试连接
  const handleTestConnection = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const res = await StorageDocs.test({ type: form.type, config: form.config });
      setTestResult({ ok: res.code === 0, message: res.message });
    } catch (e) {
      setTestResult({ ok: false, message: e.response?.data?.message || '网络错误' });
    } finally {
      setTesting(false);
    }
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
      {/* 工具栏：新增按钮（左）+ 渠道选择+刷新（右） */}
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 3, gap: 2, flexWrap: 'wrap' }}>
        <Button variant="contained" startIcon={<AddIcon />} onClick={openCreate}>新增渠道</Button>
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
                      <Card variant="outlined" sx={{ borderRadius: 2, height: '100%', display: 'flex', flexDirection: 'column' }}>
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
                            const usedGB = usedBytes / (1024 ** 3); // 字节 -> GB
                            const percent = Math.min(100, (usedBytes / (quotaLimitGB * (1024 ** 3))) * 100);
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
                                  sx={{ height: 8, borderRadius: 4 }}
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
      <Dialog open={dialogOpen} onClose={closeDialog} maxWidth="sm" fullWidth>
        <DialogTitle>{editTarget ? `编辑渠道：${editTarget.id}` : '新增存储渠道'}</DialogTitle>
        <DialogContent dividers>
          {formError && <Alert severity="error" sx={{ mb: 2 }}>{formError}</Alert>}
          {testResult && (
            <Alert severity={testResult.ok ? 'success' : 'error'} sx={{ mb: 2 }}>
              {testResult.message}
            </Alert>
          )}

          {/* 步骤 0：选择类型（仅新增时显示） */}
          {step === 0 && (
            <Box>
              <Typography variant="body2" color="text.secondary" mb={2}>选择存储类型</Typography>
              <FormControl fullWidth size="small">
                <InputLabel>存储类型</InputLabel>
                <Select value={form.type} label="存储类型" onChange={(e) => setField('type', e.target.value)}>
                  {VALID_TYPES.map((t) => (
                    <MenuItem key={t} value={t}>{t}</MenuItem>
                  ))}
                </Select>
              </FormControl>
            </Box>
          )}

          {/* 步骤 1：通用字段 */}
          {step === 1 && (
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              {!editTarget && (
                <TextField label="渠道 ID" size="small" required value={form.id}
                  onChange={(e) => setField('id', e.target.value)}
                  helperText="仅允许字母、数字、连字符，创建后不可修改" />
              )}
              <TextField label="渠道名称" size="small" required value={form.name}
                onChange={(e) => setField('name', e.target.value)} />
              <FormControlLabel
                control={<Switch checked={form.enabled} onChange={(e) => setField('enabled', e.target.checked)} />}
                label="启用渠道" />
              <FormControlLabel
                control={<Switch checked={form.allowUpload} onChange={(e) => setField('allowUpload', e.target.checked)} />}
                label="允许上传" />
              <TextField
                label="渠道权重"
                size="small"
                type="number"
                value={form.weight ?? 1}
                onChange={(e) => setField('weight', Number(e.target.value) || 1)}
                helperText="仅在负载均衡加权策略时生效，默认值为 1"
                slotProps={{ htmlInput: { min: 1, step: 1 } }}
              />

              <FormControlLabel
                control={<Switch
                  checked={form.enableQuota ?? false}
                  onChange={(e) => setField('enableQuota', e.target.checked)}
                />}
                label="容量限制"
              />

              {form.enableQuota && (
                <>
                  <TextField
                    label="容量上限 (GB)"
                    size="small"
                    type="number"
                    value={form.quotaLimitGB ?? 10}
                    onChange={(e) => setField('quotaLimitGB', Number(e.target.value) || 10)}
                    helperText="当使用量达到停用阈值时，自动关闭上传"
                    slotProps={{ htmlInput: { min: 1, max: 10000, step: 1 } }}
                  />

                  <TextField
                    label="停用阈值 (%)"
                    size="small"
                    type="number"
                    value={form.disableThresholdPercent ?? 95}
                    onChange={(e) => setField('disableThresholdPercent', Number(e.target.value) || 95)}
                    helperText="建议范围：80-100，默认 95"
                    slotProps={{ htmlInput: { min: 1, max: 100, step: 1 } }}
                  />
                </>
              )}
            </Box>
          )}

          {/* 步骤 2：类型特有 config 字段 */}
          {step === 2 && (
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              {(CHANNEL_SCHEMAS[form.type] || []).map((field) => (
                <TextField
                  key={field.key}
                  label={field.label || field.key}
                  size="small"
                  required={field.required}
                  type={field.sensitive && !showSensitive[field.key] ? 'password' : 'text'}
                  value={form.config[field.key] ?? ''}
                  onChange={(e) => setConfigField(field.key, e.target.value)}
                  placeholder={field.sensitive && editTarget ? '不修改请留空' : ''}
                  InputProps={field.sensitive ? {
                    endAdornment: (
                      <InputAdornment position="end">
                        <IconButton size="small" onClick={() =>
                          setShowSensitive((p) => ({ ...p, [field.key]: !p[field.key] }))}>
                          {showSensitive[field.key] ? <VisibilityOffIcon fontSize="small" /> : <VisibilityIcon fontSize="small" />}
                        </IconButton>
                      </InputAdornment>
                    ),
                  } : undefined}
                />
              ))}
            </Box>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={closeDialog}>取消</Button>
          {step > 0 && !editTarget && <Button onClick={() => setStep((s) => s - 1)}>上一步</Button>}
          {step === 2 && (
            <Button onClick={handleTestConnection} disabled={testing || saving}>
              {testing ? <CircularProgress size={18} /> : '测试连接'}
            </Button>
          )}
          {step < 2 ? (
            <Button variant="contained" onClick={() => setStep((s) => s + 1)}>下一步</Button>
          ) : (
            <Button variant="contained" onClick={handleSubmit} disabled={saving || testing}>
              {saving ? <CircularProgress size={18} color="inherit" /> : '保存'}
            </Button>
          )}
        </DialogActions>
      </Dialog>

      {/* 删除确认弹窗 */}
      <Dialog open={Boolean(deleteTarget)} onClose={() => setDeleteTarget(null)} maxWidth="xs" fullWidth>
        <DialogTitle>确认删除</DialogTitle>
        <DialogContent>
          <Typography>确定要删除渠道「{deleteTarget?.name}」（{deleteTarget?.id}）吗？此操作不可撤销。</Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDeleteTarget(null)}>取消</Button>
          <Button variant="contained" color="error" onClick={handleDelete} disabled={deleting}>
            {deleting ? <CircularProgress size={18} color="inherit" /> : '确认删除'}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}


