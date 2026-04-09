import {
  Box, Typography, TextField, Button, CircularProgress, Alert, Divider,
  FormControlLabel, Switch, Checkbox
} from '@mui/material';
import { useUploadConfig } from '../../hooks/useUploadConfig';
import LoadingSpinner from '../common/LoadingSpinner';

/** 辅助函数：更新 config 中的单个字段 */
function useField(config, setConfig) {
  return (field, value) => setConfig({ ...config, [field]: value });
}

export default function UploadConfigPanel() {
  const { loading, saving, result, config, setConfig, clearResult, handleSave } = useUploadConfig();
  const update = useField(config, setConfig);
  const numHandler = (key, fallback) => (e) => update(key, Number(e.target.value) || fallback);
  const switchHandler = (key) => (e) => update(key, e.target.checked);

  if (loading) {
    return <LoadingSpinner fullHeight={false} />;
  }

  return (
    <Box display="flex" flexDirection="column" gap={2.5}>
      {result && (
        <Alert severity={result.type} onClose={clearResult}>{result.msg}</Alert>
      )}

      <Typography variant="subtitle1" fontWeight="bold" mb={1}>故障转移</Typography>

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

        <Divider sx={{ my: 1 }} />

        <Typography variant="subtitle1" fontWeight="bold" mb={1}>S3 渠道</Typography>

        <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 1 }}>
          <FormControlLabel
            control={<Switch
              checked={config.enableS3Concurrent}
              onChange={switchHandler('enableS3Concurrent')}
            />}
            label="S3 并发上传"
          />
        </Box>
        <Typography variant="body2" color="text.secondary" sx={{ ml: 4, mt: -1, mb: 1 }}>
          S3 Multipart 上传使用并发模式，大幅提升大文件上传速度
        </Typography>

        <Divider sx={{ my: 1 }} />

        <Typography variant="subtitle1" fontWeight="bold" mb={1}>上传限制</Typography>
        <Typography variant="body2" color="text.secondary" mb={1}>
          渠道未单独开启对应开关时，将使用此处配置
        </Typography>

        <FormControlLabel
          control={<Switch
            checked={config.enableSizeLimit}
            onChange={(e) => {
              const checked = e.target.checked;
              setConfig({ ...config, enableSizeLimit: checked, ...(!checked && { enableChunking: false, enableMaxLimit: false }) });
            }}
          />}
          label="大小限制"
        />
        {config.enableSizeLimit && (
          <>
            <TextField
              label="单文件大小限制 (MB)"
              size="small"
              type="number"
              value={config.defaultSizeLimitMB}
              onChange={numHandler('defaultSizeLimitMB', 10)}
              helperText={'超过此大小的文件将被拒绝上传（开启分片后可突破此限制）'}
              slotProps={{ htmlInput: { min: 1, max: 10000, step: 1 } }}
              sx={{ maxWidth: 300 }}
            />

            <FormControlLabel
              control={<Switch
                checked={config.enableChunking}
                onChange={(e) => {
                  const checked = e.target.checked;
                  setConfig({ ...config, enableChunking: checked, ...(!checked && { enableMaxLimit: false }) });
                }}
              />}
              label="分片上传"
              sx={{ ml: 2 }}
            />
            {config.enableChunking && (
              <Box sx={{ ml: 4, display: 'flex', flexDirection: 'column', gap: 2 }}>
                <TextField
                  label="分片大小 (MB)"
                  size="small"
                  type="number"
                  value={config.defaultChunkSizeMB}
                  onChange={numHandler('defaultChunkSizeMB', 5)}
                  helperText={'每个分片的大小，默认 5MB'}
                  slotProps={{ htmlInput: { min: 1, max: 1000, step: 1 } }}
                  sx={{ maxWidth: 300 }}
                />
                <TextField
                  label="最大分片数"
                  size="small"
                  type="number"
                  value={config.defaultMaxChunks}
                  onChange={numHandler('defaultMaxChunks', 0)}
                  helperText={'0 表示自动计算（根据文件大小和分片大小）'}
                  slotProps={{ htmlInput: { min: 0, max: 10000, step: 1 } }}
                  sx={{ maxWidth: 300 }}
                />

                <FormControlLabel
                  control={<Switch
                    checked={config.enableMaxLimit}
                    onChange={switchHandler('enableMaxLimit')}
                  />}
                  label="最大限制"
                />
                {config.enableMaxLimit && (
                  <TextField
                    label="单文件硬上限 (MB)"
                    size="small"
                    type="number"
                    value={config.defaultMaxLimitMB}
                    onChange={numHandler('defaultMaxLimitMB', 100)}
                    helperText={'即使分片上传也不允许超过此值'}
                    slotProps={{ htmlInput: { min: 1, max: 100000, step: 1 } }}
                    sx={{ maxWidth: 300 }}
                  />
                )}
              </Box>
            )}
          </>
        )}

        <Box sx={{ display: 'flex', gap: 2, mt: 1 }}>
          <Button
            variant="contained"
            onClick={handleSave}
            disabled={saving}
          >
            {saving ? <CircularProgress size={18} color="inherit" /> : '保存配置'}
          </Button>
        </Box>
      </Box>
  );
}
