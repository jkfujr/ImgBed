import {
  Box, TextField, FormControlLabel, Switch, Divider
} from '@mui/material';

/**
 * ChannelDialog 步骤1 — 通用字段（名称、开关、权重、容量限制、大小限制等）
 */
export default function ChannelFormGeneral({ form, setField, editTarget }) {
  return (
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

      <Divider />

      {/* 大小限制 */}
      <FormControlLabel
        control={<Switch
          checked={form.enableSizeLimit}
          onChange={(e) => {
            const checked = e.target.checked;
            setField('enableSizeLimit', checked);
            if (!checked) {
              setField('enableChunking', false);
              setField('enableMaxLimit', false);
            }
          }}
        />}
        label="大小限制"
      />
      {form.enableSizeLimit && (
        <>
          <TextField
            label="单文件大小限制 (MB)"
            size="small"
            type="number"
            value={form.sizeLimitMB}
            onChange={(e) => setField('sizeLimitMB', Number(e.target.value) || 10)}
            helperText="超过此大小的文件将被拒绝上传（开启分片后可突破此限制）"
            slotProps={{ htmlInput: { min: 1, max: 10000, step: 1 } }}
          />

          {/* 分片上传 */}
          <FormControlLabel
            control={<Switch
              checked={form.enableChunking}
              onChange={(e) => {
                const checked = e.target.checked;
                setField('enableChunking', checked);
                if (!checked) {
                  setField('enableMaxLimit', false);
                }
              }}
            />}
            label="分片上传"
            sx={{ ml: 2 }}
          />
          {form.enableChunking && (
            <Box sx={{ ml: 4, display: 'flex', flexDirection: 'column', gap: 2 }}>
              <TextField
                label="分片大小 (MB)"
                size="small"
                type="number"
                value={form.chunkSizeMB}
                onChange={(e) => setField('chunkSizeMB', Number(e.target.value) || 5)}
                helperText="每个分片的大小，默认 5MB"
                slotProps={{ htmlInput: { min: 1, max: 1000, step: 1 } }}
              />
              <TextField
                label="最大分片数"
                size="small"
                type="number"
                value={form.maxChunks}
                onChange={(e) => setField('maxChunks', Number(e.target.value) || 0)}
                helperText="0 表示自动计算（根据文件大小和分片大小）"
                slotProps={{ htmlInput: { min: 0, max: 10000, step: 1 } }}
              />

              {/* 最大限制 */}
              <FormControlLabel
                control={<Switch
                  checked={form.enableMaxLimit}
                  onChange={(e) => setField('enableMaxLimit', e.target.checked)}
                />}
                label="最大限制"
              />
              {form.enableMaxLimit && (
                <TextField
                  label="单文件硬上限 (MB)"
                  size="small"
                  type="number"
                  value={form.maxLimitMB}
                  onChange={(e) => setField('maxLimitMB', Number(e.target.value) || 100)}
                  helperText="即使分片上传也不允许超过此值"
                  slotProps={{ htmlInput: { min: 1, max: 100000, step: 1 } }}
                />
              )}
            </Box>
          )}
        </>
      )}
    </Box>
  );
}
