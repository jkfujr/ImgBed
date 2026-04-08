import { Box, Paper, Stack, IconButton, ToggleButton, ToggleButtonGroup, Tooltip } from '@mui/material';
import ViewModuleIcon from '@mui/icons-material/ViewModule';
import ViewListIcon from '@mui/icons-material/ViewList';
import RefreshIcon from '@mui/icons-material/Refresh';
import BreadcrumbPathEditor from '../common/BreadcrumbPathEditor';
import { BORDER_RADIUS } from '../../utils/constants';

export default function FilesAdminToolbar({
  currentDir,
  loading,
  viewMode,
  onViewModeChange,
  onRefresh,
  onNavigateToDir,
}) {
  return (
    <Paper variant="outlined" sx={{ p: 2, borderRadius: BORDER_RADIUS.md }}>
      <Stack
        direction="row"
        spacing={2}
        alignItems="center"
        flexWrap="wrap"
      >
        {/* 左侧：面包屑路径编辑器 */}
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <BreadcrumbPathEditor
            currentDir={currentDir}
            onNavigate={onNavigateToDir}
          />
        </Box>

        {/* 右侧：视图切换 + 刷新 */}
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <ToggleButtonGroup
            value={viewMode}
            exclusive
            onChange={onViewModeChange}
            size="small"
          >
            <ToggleButton value="masonry" aria-label="瀑布流">
              <Tooltip title="瀑布流"><ViewModuleIcon fontSize="small" /></Tooltip>
            </ToggleButton>
            <ToggleButton value="list" aria-label="详细列表">
              <Tooltip title="详细列表"><ViewListIcon fontSize="small" /></Tooltip>
            </ToggleButton>
          </ToggleButtonGroup>
          <IconButton size="small" onClick={onRefresh} disabled={loading}>
            <Tooltip title="刷新"><RefreshIcon fontSize="small" /></Tooltip>
          </IconButton>
        </Box>
      </Stack>
    </Paper>
  );
}
