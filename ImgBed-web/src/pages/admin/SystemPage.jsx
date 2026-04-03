import React, { useState, useEffect } from 'react';
import {
  Box, Typography, Paper, TextField, Button, CircularProgress,
  Alert, Divider, FormControl, InputLabel, Select, MenuItem, Grid,
  Tabs, Tab, FormControlLabel, Radio, RadioGroup, FormGroup, Checkbox, Switch,
} from '@mui/material';
import { api, StorageDocs } from '../../api';
import { BORDER_RADIUS } from '../../utils/constants';

export default function SystemPage() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState(null);

  const [corsOrigin, setCorsOrigin] = useState('');
  const [maxFileSize, setMaxFileSize] = useState('');
  const [serverPort, setServerPort] = useState('');

  // Tabs 分页
  const [currentTab, setCurrentTab] = useState(0);

  // 负载均衡配置
  const [lbSaving, setLbSaving] = useState(false);
  const [lbResult, setLbResult] = useState(null);
  const [uploadStrategy, setUploadStrategy] = useState('default'); // 顶层选项：default / load-balance
  const [lbStrategy, setLbStrategy] = useState('round-robin');
  const [lbScope, setLbScope] = useState('global');
  const [lbEnabledTypes, setLbEnabledTypes] = useState([]);
  const [lbWeights, setLbWeights] = useState({});
  const [failoverEnabled, setFailoverEnabled] = useState(true);
  const [availableChannels, setAvailableChannels] = useState([]);

  // 上传配置 - 容量检查
  const [quotaCheckMode, setQuotaCheckMode] = useState('auto');
  const [fullCheckIntervalHours, setFullCheckIntervalHours] = useState(6);
  const [savingUpload, setSavingUpload] = useState(false);
  const [uploadResult, setUploadResult] = useState(null);

  // 上传配置 - 上传限制
  const [sysEnableSizeLimit, setSysEnableSizeLimit] = useState(false);
  const [sysEnableChunking, setSysEnableChunking] = useState(false);
  const [sysEnableMaxLimit, setSysEnableMaxLimit] = useState(false);
  const [defaultSizeLimitMB, setDefaultSizeLimitMB] = useState(10);
  const [defaultChunkSizeMB, setDefaultChunkSizeMB] = useState(5);
  const [defaultMaxChunks, setDefaultMaxChunks] = useState(0);
  const [defaultMaxLimitMB, setDefaultMaxLimitMB] = useState(100);

  useEffect(() => {
    const loadInitialData = async () => {
      setLoading(true);
      try {
        // 并行加载 3 个 API
        const [configRes, lbRes, channelsRes] = await Promise.all([
          api.get('/api/system/config'),
          StorageDocs.getLoadBalance().catch(() => ({
            code: -1,
            data: { strategy: 'default' }
          })),
          StorageDocs.list().catch(() => ({
            code: -1,
            data: { list: [] }
          }))
        ]);

        // 处理系统配置
        if (configRes.code === 0) {
          setCorsOrigin(configRes.data.security?.corsOrigin || '*');
          setMaxFileSize(String((configRes.data.security?.maxFileSize || 104857600) / (1024 * 1024)));
          setServerPort(String(configRes.data.server?.port || 3000));
          // 加载上传配置
          setQuotaCheckMode(configRes.data.upload?.quotaCheckMode || 'auto');
          setFullCheckIntervalHours(configRes.data.upload?.fullCheckIntervalHours || 6);
          setSysEnableSizeLimit(configRes.data.upload?.enableSizeLimit ?? false);
          setDefaultSizeLimitMB(configRes.data.upload?.defaultSizeLimitMB || 10);
          setSysEnableChunking(configRes.data.upload?.enableChunking ?? false);
          setDefaultChunkSizeMB(configRes.data.upload?.defaultChunkSizeMB || 5);
          setDefaultMaxChunks(configRes.data.upload?.defaultMaxChunks ?? 0);
          setSysEnableMaxLimit(configRes.data.upload?.enableMaxLimit ?? false);
          setDefaultMaxLimitMB(configRes.data.upload?.defaultMaxLimitMB || 100);
        }

        // 处理负载均衡配置
        if (lbRes.code === 0) {
          const strategy = lbRes.data.strategy || 'default';
          setLbStrategy(strategy === 'default' ? 'round-robin' : strategy);
          setLbWeights(lbRes.data.weights || {});
          setLbScope(lbRes.data.scope || 'global');
          setLbEnabledTypes(lbRes.data.enabledTypes || []);
          setFailoverEnabled(lbRes.data.failoverEnabled !== false);
          setUploadStrategy(strategy === 'default' ? 'default' : 'load-balance');
        }

        // 处理渠道列表
        if (channelsRes.code === 0) {
          setAvailableChannels(channelsRes.data.list || []);
        }
      } catch {
        setResult({ type: 'error', msg: '加载配置失败，请检查网络或后端服务' });
      } finally {
        setLoading(false);
      }
    };

    loadInitialData();
  }, []);

  const handleSaveLb = async () => {
    setLbResult(null);
    setLbSaving(true);
    try {
      // 根据顶层选项决定最终策略
      const finalStrategy = uploadStrategy === 'default' ? 'default' : lbStrategy;
      const res = await StorageDocs.updateLoadBalance({
        strategy: finalStrategy,
        scope: lbScope,
        enabledTypes: lbEnabledTypes,
        weights: lbWeights,
        failoverEnabled
      });
      if (res.code === 0) {
        setLbResult({ type: 'success', msg: '负载均衡配置已保存' });
      } else {
        setLbResult({ type: 'error', msg: res.message || '保存失败' });
      }
    } catch (err) {
      setLbResult({ type: 'error', msg: err.response?.data?.message || '网络错误' });
    } finally {
      setLbSaving(false);
    }
  };

  const handleSave = async () => {
    setResult(null);
    setSaving(true);
    try {
      const payload = {
        security: {
          corsOrigin,
          maxFileSize: Math.round(parseFloat(maxFileSize) * 1024 * 1024),
        },
        server: { port: parseInt(serverPort) },
      };
      const res = await api.put('/api/system/config', payload);
      if (res.code === 0) {
        setResult({ type: 'success', msg: res.message });
      } else {
        setResult({ type: 'error', msg: res.message || '保存失败' });
      }
    } catch (err) {
      setResult({ type: 'error', msg: err.response?.data?.message || '网络错误' });
    } finally {
      setSaving(false);
    }
  };

  // 获取所有唯一的渠道类型，用于勾选框
  const uniqueTypes = [...new Set(availableChannels.map(s => s.type))];

  // 处理类型勾选切换
  const toggleType = (type) => {
    if (lbEnabledTypes.includes(type)) {
      setLbEnabledTypes(lbEnabledTypes.filter(t => t !== type));
    } else {
      setLbEnabledTypes([...lbEnabledTypes, type]);
    }
  };

  // 保存上传配置
  const handleSaveUploadConfig = async () => {
    setSavingUpload(true);
    try {
      const payload = {
        upload: {
          quotaCheckMode,
          fullCheckIntervalHours,
          enableSizeLimit: sysEnableSizeLimit,
          defaultSizeLimitMB,
          enableChunking: sysEnableChunking,
          defaultChunkSizeMB,
          defaultMaxChunks,
          enableMaxLimit: sysEnableMaxLimit,
          defaultMaxLimitMB,
        }
      };
      const res = await api.put('/api/system/config', payload);
      if (res.code === 0) {
        setUploadResult({ type: 'success', msg: '上传配置已保存，重启服务后定时间隔生效' });
      } else {
        setUploadResult({ type: 'error', msg: res.message || '保存失败' });
      }
    } catch (err) {
      setUploadResult({ type: 'error', msg: err.response?.data?.message || '网络错误' });
    } finally {
      setSavingUpload(false);
    }
  };

  if (loading) {
    return <Box display="flex" justifyContent="center" pt={6}><CircularProgress /></Box>;
  }

  return (
    <Box sx={{ maxWidth: 800 }}>
      <Box sx={{ borderBottom: 1, borderColor: 'divider', mb: 3 }}>
        <Tabs value={currentTab} onChange={(e, newValue) => setCurrentTab(newValue)}>
          <Tab label="系统配置" />
          <Tab label="存储策略" />
          <Tab label="上传配置" />
        </Tabs>
      </Box>

      {/* 分页 1: 系统配置 */}
      {currentTab === 0 && (
        <Paper variant="outlined" sx={{ borderRadius: BORDER_RADIUS.md, px: 3, py: 3 }}>
          <Box display="flex" flexDirection="column" gap={2.5}>
            {result && (
              <Alert severity={result.type} onClose={() => setResult(null)}>{result.msg}</Alert>
            )}

            <TextField
              label="服务端口"
              size="small"
              value={serverPort}
              onChange={(e) => setServerPort(e.target.value)}
              helperText="修改后需重启后端服务生效"
              sx={{ maxWidth: 200 }}
            />

            <Divider />

            <TextField
              label="CORS 允许来源"
              size="small"
              value={corsOrigin}
              onChange={(e) => setCorsOrigin(e.target.value)}
              helperText="填 * 表示允许所有来源，生产环境建议填写具体域名"
            />

            <TextField
              label="最大上传文件大小（MB）"
              size="small"
              type="number"
              value={maxFileSize}
              onChange={(e) => setMaxFileSize(e.target.value)}
              slotProps={{ htmlInput: { min: 1, step: 1 } }}
              sx={{ maxWidth: 280 }}
            />

            <Box>
              <Button
                variant="contained"
                onClick={handleSave}
                disabled={saving}
              >
                {saving ? <CircularProgress size={18} color="inherit" /> : '保存配置'}
              </Button>
            </Box>
          </Box>
        </Paper>
      )}

      {/* 分页 2: 存储策略 */}
      {currentTab === 1 && (
        <Paper variant="outlined" sx={{ borderRadius: BORDER_RADIUS.md, px: 3, py: 3 }}>
          <Box display="flex" flexDirection="column" gap={2.5}>
            {lbResult && (
              <Alert severity={lbResult.type} onClose={() => setLbResult(null)}>{lbResult.msg}</Alert>
            )}
            {/* 顶层选项：默认渠道 / 负载均衡 */}
            <FormControl component="fieldset">
              <RadioGroup
                value={uploadStrategy}
                onChange={(e) => setUploadStrategy(e.target.value)}
              >
                <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 1, py: 1 }}>
                  <Radio checked={uploadStrategy === 'default'} value="default" size="medium" />
                  <Box sx={{ pt: 0.5 }}>
                    <Typography>默认渠道</Typography>
                    <Typography variant="body2" color="text.secondary">
                      所有上传使用默认存储渠道
                    </Typography>
                  </Box>
                </Box>
                <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 1, py: 1 }}>
                  <Radio checked={uploadStrategy === 'load-balance'} value="load-balance" size="medium" />
                  <Box sx={{ pt: 0.5 }}>
                    <Typography>负载均衡</Typography>
                    <Typography variant="body2" color="text.secondary">
                      在多个可用渠道间自动分配上传
                    </Typography>
                  </Box>
                </Box>
              </RadioGroup>
            </FormControl>

            {/* 负载均衡配置（仅当选择负载均衡时显示） */}
            {uploadStrategy === 'load-balance' && (
              <>
                <Divider />

                {/* 负载均衡作用域 */}
                <FormControl component="fieldset">
                  <Typography variant="body2" fontWeight="medium" mb={1}>负载均衡作用域</Typography>
                  <RadioGroup
                    value={lbScope}
                    onChange={(e) => setLbScope(e.target.value)}
                  >
                    <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 1, py: 1 }}>
                      <Radio checked={lbScope === 'global'} value="global" size="medium" />
                      <Box sx={{ pt: 0.5 }}>
                        <Typography>全局负载均衡</Typography>
                        <Typography variant="body2" color="text.secondary">
                          在所有可用渠道之间进行负载均衡
                        </Typography>
                      </Box>
                    </Box>
                    <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 1, py: 1 }}>
                      <Radio checked={lbScope === 'byType'} value="byType" size="medium" />
                      <Box sx={{ pt: 0.5 }}>
                        <Typography>按类型分组负载均衡</Typography>
                        <Typography variant="body2" color="text.secondary">
                          仅同一类型内的可用渠道中进行负载均衡。例如上传偏好选择本地类型，则永远不会上传到Telegram
                        </Typography>
                      </Box>
                    </Box>
                  </RadioGroup>
                </FormControl>

                {/* 按类型分组时显示勾选框 */}
                {lbScope === 'byType' && uniqueTypes.length > 0 && (
                  <FormGroup sx={{ pl: 3 }}>
                    <Typography variant="body2" color="text.secondary" mb={1}>
                      勾选开启按类型负载均衡的渠道类型：
                    </Typography>
                    <Grid container spacing={2}>
                      {uniqueTypes.map(type => (
                        <Grid size={{ xs: 6, sm: 4 }} key={type}>
                          <FormControlLabel
                            control={
                              <Checkbox
                                checked={lbEnabledTypes.includes(type)}
                                onChange={() => toggleType(type)}
                              />
                            }
                            label={type}
                          />
                        </Grid>
                      ))}
                    </Grid>
                  </FormGroup>
                )}

                <Divider />

                {/* 具体负载均衡策略 */}
                <FormControl size="small" sx={{ maxWidth: 320 }}>
                  <InputLabel>均衡算法</InputLabel>
                  <Select
                    value={lbStrategy}
                    label="均衡算法"
                    onChange={(e) => setLbStrategy(e.target.value)}
                  >
                    <MenuItem value="round-robin">轮询</MenuItem>
                    <MenuItem value="random">随机</MenuItem>
                    <MenuItem value="least-used">最少使用</MenuItem>
                    <MenuItem value="weighted">加权</MenuItem>
                  </Select>
                </FormControl>

                {/* 策略说明 */}
                <Typography variant="body2" color="text.secondary">
                  {lbStrategy === 'round-robin' && '在所有可上传渠道中按顺序轮流分配'}
                  {lbStrategy === 'random' && '在所有可上传渠道中随机选择'}
                  {lbStrategy === 'least-used' && '优先选择文件数最少的渠道'}
                  {lbStrategy === 'weighted' && '按各渠道权重比例随机分配'}
                </Typography>

                {/* 加权策略权重编辑（保持向后兼容） */}
                {lbStrategy === 'weighted' && (
                  <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 2, alignItems: 'center' }}>
                    {availableChannels.filter(s => s.enabled && s.allowUpload).map(s => (
                      <Box key={s.id} sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                        <Typography variant="body2" noWrap>{s.name}:</Typography>
                        <TextField
                          type="number"
                          size="small"
                          value={lbWeights[s.id] ?? (s.weight ?? 1)}
                          slotProps={{ htmlInput: { min: 1, step: 1 } }}
                          onChange={(e) => setLbWeights(prev => ({ ...prev, [s.id]: Number(e.target.value) || 1 }))}
                          sx={{ width: 80 }}
                          helperText={`渠道权重: ${s.weight ?? 1}`}
                        />
                      </Box>
                    ))}
                    {availableChannels.filter(s => s.enabled && s.allowUpload).length === 0 && (
                      <Typography variant="body2" color="text.secondary">暂无可上传渠道</Typography>
                    )}
                  </Box>
                )}
              </>
            )}

            <Divider />

            {/* 失败自动切换 */}
            <FormControlLabel
              control={
                <Checkbox
                  checked={failoverEnabled}
                  onChange={(e) => setFailoverEnabled(e.target.checked)}
                />
              }
              label={
                <Box>
                  <Typography>上传失败自动切换渠道</Typography>
                  <Typography variant="body2" color="text.secondary">
                    上传失败时自动尝试其他可用渠道（最多重试 3 次）
                  </Typography>
                </Box>
              }
              sx={{ alignItems: 'flex-start', ml: 0 }}
            />

            <Box>
              <Button variant="contained" onClick={handleSaveLb} disabled={lbSaving}>
                {lbSaving ? <CircularProgress size={18} color="inherit" /> : '保存策略'}
              </Button>
            </Box>
          </Box>
        </Paper>
      )}

      {/* 分页 3: 上传配置 */}
      {currentTab === 2 && (
        <Paper variant="outlined" sx={{ borderRadius: BORDER_RADIUS.md, px: 3, py: 3 }}>
          <Typography variant="subtitle1" fontWeight="bold" mb={2}>容量检查</Typography>
          <Box display="flex" flexDirection="column" gap={2.5}>
            {uploadResult && (
              <Alert severity={uploadResult.type} onClose={() => setUploadResult(null)}>{uploadResult.msg}</Alert>
            )}
            <FormControl component="fieldset">
              <RadioGroup
                value={quotaCheckMode}
                onChange={(e) => setQuotaCheckMode(e.target.value)}
              >
                <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 1, py: 1 }}>
                  <Radio checked={quotaCheckMode === 'auto'} value="auto" size="medium" />
                  <Box sx={{ pt: 0.5 }}>
                    <Typography>自动</Typography>
                    <Typography variant="body2" color="text.secondary">
                      内存缓存已用容量 + 上传/删除增量更新 + 定时全量校正。
                    </Typography>
                  </Box>
                </Box>
                <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 1, py: 1 }}>
                  <Radio checked={quotaCheckMode === 'always'} value="always" size="medium" />
                  <Box sx={{ pt: 0.5 }}>
                    <Typography>全量检查</Typography>
                    <Typography variant="body2" color="text.secondary">
                      每次上传都遍历数据库全量统计，准确但较慢，不推荐
                    </Typography>
                  </Box>
                </Box>
              </RadioGroup>
            </FormControl>

            {quotaCheckMode === 'auto' && (
              <TextField
                label="定时全量校正间隔（小时）"
                size="small"
                type="number"
                value={fullCheckIntervalHours}
                onChange={(e) => setFullCheckIntervalHours(Math.max(1, Number(e.target.value) || 6))}
                helperText="定期从数据库全量校正，防止缓存与实际不一致。默认 6 小时"
                slotProps={{ htmlInput: { min: 1, max: 168, step: 1 } }}
                sx={{ maxWidth: 300 }}
              />
            )}

            <Divider sx={{ my: 1 }} />

            <Typography variant="subtitle1" fontWeight="bold" mb={1}>上传限制</Typography>
            <Typography variant="body2" color="text.secondary" mb={1}>
              渠道未单独开启对应开关时，将使用此处配置
            </Typography>

            {/* 大小限制 */}
            <FormControlLabel
              control={<Switch
                checked={sysEnableSizeLimit}
                onChange={(e) => {
                  const checked = e.target.checked;
                  setSysEnableSizeLimit(checked);
                  if (!checked) {
                    setSysEnableChunking(false);
                    setSysEnableMaxLimit(false);
                  }
                }}
              />}
              label="大小限制"
            />
            {sysEnableSizeLimit && (
              <>
                <TextField
                  label="单文件大小限制 (MB)"
                  size="small"
                  type="number"
                  value={defaultSizeLimitMB}
                  onChange={(e) => setDefaultSizeLimitMB(Number(e.target.value) || 10)}
                  helperText={'超过此大小的文件将被拒绝上传（开启分片后可突破此限制）'}
                  slotProps={{ htmlInput: { min: 1, max: 10000, step: 1 } }}
                  sx={{ maxWidth: 300 }}
                />

                {/* 分片上传 */}
                <FormControlLabel
                  control={<Switch
                    checked={sysEnableChunking}
                    onChange={(e) => {
                      const checked = e.target.checked;
                      setSysEnableChunking(checked);
                      if (!checked) {
                        setSysEnableMaxLimit(false);
                      }
                    }}
                  />}
                  label="分片上传"
                  sx={{ ml: 2 }}
                />
                {sysEnableChunking && (
                  <Box sx={{ ml: 4, display: 'flex', flexDirection: 'column', gap: 2 }}>
                    <TextField
                      label="分片大小 (MB)"
                      size="small"
                      type="number"
                      value={defaultChunkSizeMB}
                      onChange={(e) => setDefaultChunkSizeMB(Number(e.target.value) || 5)}
                      helperText={'每个分片的大小，默认 5MB'}
                      slotProps={{ htmlInput: { min: 1, max: 1000, step: 1 } }}
                      sx={{ maxWidth: 300 }}
                    />
                    <TextField
                      label="最大分片数"
                      size="small"
                      type="number"
                      value={defaultMaxChunks}
                      onChange={(e) => setDefaultMaxChunks(Number(e.target.value) || 0)}
                      helperText={'0 表示自动计算（根据文件大小和分片大小）'}
                      slotProps={{ htmlInput: { min: 0, max: 10000, step: 1 } }}
                      sx={{ maxWidth: 300 }}
                    />

                    {/* 最大限制 */}
                    <FormControlLabel
                      control={<Switch
                        checked={sysEnableMaxLimit}
                        onChange={(e) => setSysEnableMaxLimit(e.target.checked)}
                      />}
                      label="最大限制"
                    />
                    {sysEnableMaxLimit && (
                      <TextField
                        label="单文件硬上限 (MB)"
                        size="small"
                        type="number"
                        value={defaultMaxLimitMB}
                        onChange={(e) => setDefaultMaxLimitMB(Number(e.target.value) || 100)}
                        helperText={'即使分片上传也不允许超过此值'}
                        slotProps={{ htmlInput: { min: 1, max: 100000, step: 1 } }}
                        sx={{ maxWidth: 300 }}
                      />
                    )}
                  </Box>
                )}
              </>
            )}

            <Box>
              <Button
                variant="contained"
                onClick={handleSaveUploadConfig}
                disabled={savingUpload}
              >
                {savingUpload ? <CircularProgress size={18} color="inherit" /> : '保存配置'}
              </Button>
            </Box>
          </Box>
        </Paper>
      )}
    </Box>
  );
}
