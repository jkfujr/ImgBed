import { useMemo } from 'react';
import {
  Box, Typography, Button, CircularProgress, Alert, Divider,
  FormControl, InputLabel, Select, MenuItem, Grid, Radio, RadioGroup,
  FormGroup, Checkbox, FormControlLabel, TextField, Switch
} from '@mui/material';
import { useLoadBalance } from '../../hooks/useLoadBalance';
import LoadingSpinner from '../common/LoadingSpinner';

/** 辅助：更新 config 单字段 */
function useField(config, setConfig) {
  return (field, value) => setConfig({ ...config, [field]: value });
}

export default function LoadBalancePanel() {
  const { loading, saving, result, config, setConfig, availableChannels, clearResult, handleSave, toggleType } = useLoadBalance();
  const update = useField(config, setConfig);

  const uniqueTypes = useMemo(() => [...new Set(availableChannels.map(s => s.type))], [availableChannels]);
  const uploadableChannels = useMemo(() => availableChannels.filter(s => s.enabled && s.allowUpload), [availableChannels]);

  if (loading) {
    return <LoadingSpinner fullHeight={false} />;
  }

  return (
    <Box display="flex" flexDirection="column" gap={2.5}>
      {result && (
        <Alert severity={result.type} onClose={clearResult}>{result.msg}</Alert>
      )}

      <Typography variant="subtitle1" fontWeight="bold" mb={1}>存储策略</Typography>

      <FormControl component="fieldset">
          <RadioGroup
            value={config.uploadStrategy}
            onChange={(e) => update('uploadStrategy', e.target.value)}
          >
            <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 1, py: 1 }}>
              <Radio checked={config.uploadStrategy === 'default'} value="default" size="medium" />
              <Box sx={{ pt: 0.5 }}>
                <Typography>默认渠道</Typography>
                <Typography variant="body2" color="text.secondary">
                  所有上传使用默认存储渠道
                </Typography>
              </Box>
            </Box>
            <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 1, py: 1 }}>
              <Radio checked={config.uploadStrategy === 'load-balance'} value="load-balance" size="medium" />
              <Box sx={{ pt: 0.5 }}>
                <Typography>负载均衡</Typography>
                <Typography variant="body2" color="text.secondary">
                  在多个可用渠道间自动分配上传
                </Typography>
              </Box>
            </Box>
          </RadioGroup>
        </FormControl>

        {config.uploadStrategy === 'load-balance' && (
          <>
            <Divider sx={{ my: 1 }} />

            <FormControl component="fieldset">
              <Typography variant="subtitle1" fontWeight="bold" mb={1}>负载均衡作用域</Typography>
              <RadioGroup
                value={config.lbScope}
                onChange={(e) => update('lbScope', e.target.value)}
              >
                <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 1, py: 1 }}>
                  <Radio checked={config.lbScope === 'global'} value="global" size="medium" />
                  <Box sx={{ pt: 0.5 }}>
                    <Typography>全局负载均衡</Typography>
                    <Typography variant="body2" color="text.secondary">
                      在所有可用渠道之间进行负载均衡
                    </Typography>
                  </Box>
                </Box>
                <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 1, py: 1 }}>
                  <Radio checked={config.lbScope === 'byType'} value="byType" size="medium" />
                  <Box sx={{ pt: 0.5 }}>
                    <Typography>按类型分组负载均衡</Typography>
                    <Typography variant="body2" color="text.secondary">
                      仅同一类型内的可用渠道中进行负载均衡。例如上传偏好选择本地类型，则永远不会上传到Telegram
                    </Typography>
                  </Box>
                </Box>
              </RadioGroup>
            </FormControl>

            {config.lbScope === 'byType' && uniqueTypes.length > 0 && (
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
                            checked={config.lbEnabledTypes.includes(type)}
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

            <Divider sx={{ my: 1 }} />

            <Typography variant="subtitle1" fontWeight="bold" mb={1}>均衡算法</Typography>

            <FormControl size="small" sx={{ maxWidth: 320 }}>
              <InputLabel>均衡算法</InputLabel>
              <Select
                value={config.lbStrategy}
                label="均衡算法"
                onChange={(e) => update('lbStrategy', e.target.value)}
              >
                <MenuItem value="round-robin">轮询</MenuItem>
                <MenuItem value="random">随机</MenuItem>
                <MenuItem value="least-used">最少使用</MenuItem>
                <MenuItem value="weighted">加权</MenuItem>
              </Select>
            </FormControl>

            <Typography variant="body2" color="text.secondary">
              {config.lbStrategy === 'round-robin' && '在所有可上传渠道中按顺序轮流分配'}
              {config.lbStrategy === 'random' && '在所有可上传渠道中随机选择'}
              {config.lbStrategy === 'least-used' && '优先选择文件数最少的渠道'}
              {config.lbStrategy === 'weighted' && '按各渠道权重比例随机分配'}
            </Typography>

            {config.lbStrategy === 'weighted' && (
              <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 2, alignItems: 'center' }}>
                {uploadableChannels.map(s => (
                  <Box key={s.id} sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                    <Typography variant="body2" noWrap>{s.name}:</Typography>
                    <TextField
                      type="number"
                      size="small"
                      value={config.lbWeights[s.id] ?? (s.weight ?? 1)}
                      slotProps={{ htmlInput: { min: 1, step: 1 } }}
                      onChange={(e) => setConfig(prev => ({ ...prev, lbWeights: { ...prev.lbWeights, [s.id]: Number(e.target.value) || 1 } }))}
                      sx={{ width: 80 }}
                      helperText={`渠道权重: ${s.weight ?? 1}`}
                    />
                  </Box>
                ))}
                {uploadableChannels.length === 0 && (
                  <Typography variant="body2" color="text.secondary">暂无可上传渠道</Typography>
                )}
              </Box>
            )}
          </>
        )}

        <Divider sx={{ my: 1 }} />

        <Typography variant="subtitle1" fontWeight="bold" mb={1}>容量检查</Typography>

        <FormControlLabel
          control={
            <Switch
              checked={config.enableFullCheckInterval}
              onChange={(e) => update('enableFullCheckInterval', e.target.checked)}
            />
          }
          label="定时全量校正"
        />

        {config.enableFullCheckInterval && (
          <TextField
            label="定时全量校正间隔（小时）"
            size="small"
            type="number"
            value={config.fullCheckIntervalHours}
            onChange={(e) => update('fullCheckIntervalHours', Math.max(1, Number(e.target.value) || 6))}
            helperText="定期从数据库全量校正，防止缓存与实际不一致。默认 6 小时"
            slotProps={{ htmlInput: { min: 1, max: 168, step: 1 } }}
            sx={{ maxWidth: 300, ml: 4 }}
          />
        )}

        <Box sx={{ display: 'flex', gap: 2, mt: 1 }}>
          <Button variant="contained" onClick={handleSave} disabled={saving}>
            {saving ? <CircularProgress size={18} color="inherit" /> : '保存策略'}
          </Button>
        </Box>
      </Box>
  );
}
