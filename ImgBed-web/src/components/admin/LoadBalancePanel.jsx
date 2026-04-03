import {
  Box, Typography, Paper, Button, CircularProgress, Alert, Divider,
  FormControl, InputLabel, Select, MenuItem, Grid, Radio, RadioGroup,
  FormGroup, Checkbox, FormControlLabel, TextField
} from '@mui/material';
import { useLoadBalance } from '../../hooks/useLoadBalance';
import { BORDER_RADIUS } from '../../utils/constants';

/** 辅助：更新 config 单字段 */
function useField(config, setConfig) {
  return (field, value) => setConfig({ ...config, [field]: value });
}

export default function LoadBalancePanel() {
  const { loading, saving, result, config, setConfig, availableChannels, clearResult, handleSave, toggleType } = useLoadBalance();
  const update = useField(config, setConfig);

  const uniqueTypes = [...new Set(availableChannels.map(s => s.type))];

  if (loading) {
    return <Box display="flex" justifyContent="center" pt={6}><CircularProgress /></Box>;
  }

  return (
    <Paper variant="outlined" sx={{ borderRadius: BORDER_RADIUS.md, px: 3, py: 3 }}>
      <Box display="flex" flexDirection="column" gap={2.5}>
        {result && (
          <Alert severity={result.type} onClose={clearResult}>{result.msg}</Alert>
        )}

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
            <Divider />

            <FormControl component="fieldset">
              <Typography variant="body2" fontWeight="medium" mb={1}>负载均衡作用域</Typography>
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

            <Divider />

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
                {availableChannels.filter(s => s.enabled && s.allowUpload).map(s => (
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
                {availableChannels.filter(s => s.enabled && s.allowUpload).length === 0 && (
                  <Typography variant="body2" color="text.secondary">暂无可上传渠道</Typography>
                )}
              </Box>
            )}
          </>
        )}

        <Divider />

        <FormControlLabel
          control={
            <Checkbox
              checked={config.failoverEnabled}
              onChange={(e) => update('failoverEnabled', e.target.checked)}
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
          <Button variant="contained" onClick={handleSave} disabled={saving}>
            {saving ? <CircularProgress size={18} color="inherit" /> : '保存策略'}
          </Button>
        </Box>
      </Box>
    </Paper>
  );
}
