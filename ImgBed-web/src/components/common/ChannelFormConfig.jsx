import {
  Box, TextField, InputAdornment, IconButton, FormControlLabel, Switch
} from '@mui/material';
import VisibilityIcon from '@mui/icons-material/Visibility';
import VisibilityOffIcon from '@mui/icons-material/VisibilityOff';
import { CHANNEL_SCHEMAS } from '../../utils/constants';

/**
 * ChannelDialog 步骤2 — 类型特有 config 字段
 */
export default function ChannelFormConfig({ form, setConfigField, showSensitive, setShowSensitive, editTarget }) {
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      {(CHANNEL_SCHEMAS[form.type] || []).map((field) => {
        if (field.type === 'boolean') {
          return (
            <FormControlLabel
              key={field.key}
              control={(
                <Switch
                  checked={Boolean(form.config[field.key])}
                  onChange={(e) => setConfigField(field.key, e.target.checked)}
                />
              )}
              label={field.label || field.key}
            />
          );
        }

        return (
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
        );
      })}
    </Box>
  );
}
