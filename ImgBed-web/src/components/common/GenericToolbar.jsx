import { Fragment } from 'react';
import {
  Box, Paper, Stack, Typography, FormControl, InputLabel, Select, MenuItem,
  TextField, IconButton, Button, Tooltip
} from '@mui/material';
import { BORDER_RADIUS } from '../../utils/constants';

/**
 * 通用工具栏组件
 *
 * 支持三区域布局：
 * - 左侧：统计信息展示
 * - 中间：筛选器（select、text、date、custom）
 * - 右侧：操作按钮（button、iconButton、custom）
 *
 * @example
 * <GenericToolbar
 *   stats={{
 *     items: [
 *       { label: '共', value: 10, bold: true },
 *       { label: '已启用', value: 8, color: 'success.main', bold: true }
 *     ]
 *   }}
 *   filters={[
 *     {
 *       type: 'select',
 *       label: '类型筛选',
 *       value: typeFilter,
 *       onChange: setTypeFilter,
 *       options: [{ value: 'all', label: '全部' }]
 *     }
 *   ]}
 *   actions={[
 *     {
 *       type: 'iconButton',
 *       icon: <RefreshIcon />,
 *       tooltip: '刷新',
 *       onClick: handleRefresh
 *     }
 *   ]}
 * />
 */
export default function GenericToolbar({
  stats,
  filters,
  actions,
  variant = 'outlined',
  spacing = 2,
  flexWrap = true,
  loading = false,
}) {
  return (
    <Paper variant={variant} sx={{ p: spacing, borderRadius: BORDER_RADIUS.md }}>
      <Stack
        direction="row"
        spacing={spacing}
        alignItems="center"
        flexWrap={flexWrap ? 'wrap' : 'nowrap'}
      >
        {/* 左侧统计信息区域 */}
        {stats && (
          <Box sx={{ flex: 1, minWidth: 200 }}>
            <Typography variant="body2" color="text.secondary">
              {stats.items.map((item, index) => (
                <Fragment key={index}>
                  {item.label}{' '}
                  <Typography
                    component="span"
                    fontWeight={item.bold !== false ? 'bold' : 'normal'}
                    color={item.color || 'text.primary'}
                  >
                    {item.value}
                  </Typography>
                  {index < stats.items.length - 1 && (stats.separator || ' · ')}
                </Fragment>
              ))}
            </Typography>
          </Box>
        )}

        {/* 中间筛选器区域 */}
        {filters && filters.map((filter, index) => (
          <Box key={index}>
            {filter.type === 'select' && (
              <FormControl size="small" sx={{ minWidth: filter.minWidth || 120 }}>
                {filter.label && <InputLabel>{filter.label}</InputLabel>}
                <Select
                  value={filter.value}
                  label={filter.label}
                  onChange={(e) => filter.onChange(e.target.value)}
                  disabled={loading}
                >
                  {filter.options?.map(opt => (
                    <MenuItem key={opt.value} value={opt.value}>
                      {opt.label}
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>
            )}

            {filter.type === 'text' && (
              <TextField
                size="small"
                label={filter.label}
                placeholder={filter.placeholder}
                value={filter.value}
                onChange={(e) => filter.onChange(e.target.value)}
                disabled={loading}
                sx={{ minWidth: filter.minWidth || 200 }}
              />
            )}

            {filter.type === 'custom' && filter.component}
          </Box>
        ))}

        {/* 右侧操作按钮区域 */}
        {actions && actions.map((action, index) => (
          <Box key={index}>
            {action.type === 'iconButton' && (
              <Tooltip title={action.tooltip || ''}>
                <span>
                  <IconButton
                    size="small"
                    onClick={action.onClick}
                    disabled={action.disabled || loading}
                    color={action.color}
                  >
                    {action.icon}
                  </IconButton>
                </span>
              </Tooltip>
            )}

            {action.type === 'button' && (
              <Button
                size="small"
                variant={action.variant || 'contained'}
                startIcon={action.icon}
                onClick={action.onClick}
                disabled={action.disabled || loading}
                color={action.color}
              >
                {action.label}
              </Button>
            )}

            {action.type === 'custom' && action.component}
          </Box>
        ))}
      </Stack>
    </Paper>
  );
}
