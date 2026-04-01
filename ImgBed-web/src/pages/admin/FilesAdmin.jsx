import React, { useEffect, useState, useCallback, useRef } from 'react';
import {
  Box, Typography, ImageList, Checkbox, Chip,
  IconButton, Tooltip, Dialog, DialogTitle, DialogContent,
  DialogActions, Button, CircularProgress, TextField, InputAdornment,
  Paper, Breadcrumbs, Link, ToggleButtonGroup, ToggleButton, Divider,
  Table, TableHead, TableBody, TableRow, TableCell, Alert,
  FormControl, InputLabel, Select, MenuItem, LinearProgress,
  useTheme, useMediaQuery
} from '@mui/material';
import DeleteIcon from '@mui/icons-material/Delete';
import SearchIcon from '@mui/icons-material/Search';
import RefreshIcon from '@mui/icons-material/Refresh';
import FolderIcon from '@mui/icons-material/Folder';
import NavigateNextIcon from '@mui/icons-material/NavigateNext';
import ViewModuleIcon from '@mui/icons-material/ViewModule';
import ViewListIcon from '@mui/icons-material/ViewList';
import CompareArrowsIcon from '@mui/icons-material/CompareArrows';
import MasonryImageItem from '../../components/admin/MasonryImageItem';
import ConfirmDialog from '../../components/common/ConfirmDialog';
import { useDebouncedValue } from '../../hooks/useDebouncedValue';
import { useUserPreference } from '../../hooks/useUserPreference';
import { fmtDate, fmtSize, parseChannelName, channelTypeLabel } from '../../utils/formatters';
import { FileDocs, DirectoryDocs, StorageDocs } from '../../api';

import { DEFAULT_PAGE_SIZE, BORDER_RADIUS } from '../../utils/constants';

const PAGE_SIZE = DEFAULT_PAGE_SIZE;

export default function FilesAdmin() {
  const theme = useTheme();
  const isXl = useMediaQuery(theme.breakpoints.up('xl'));
  const isLg = useMediaQuery(theme.breakpoints.up('lg'));
  const isMd = useMediaQuery(theme.breakpoints.up('md'));
  const [prefCols] = useUserPreference('pref_masonry_cols', '0');
  const autoCols = isXl ? 5 : isLg ? 4 : isMd ? 3 : 2;
  const cols = parseInt(prefCols) > 0 ? parseInt(prefCols) : autoCols;

  const [viewMode, setViewMode] = useUserPreference('pref_view_mode', 'masonry');
  const [data, setData] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [directories, setDirectories] = useState([]);
  const [currentDir, setCurrentDir] = useState(null);
  const [selected, setSelected] = useState(new Set());
  const [searchInput, setSearchInput] = useState('');
  const searchDebounced = useDebouncedValue(searchInput, 300);
  const [deleteDialog, setDeleteDialog] = useState({ open: false, ids: [], label: '' });
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState(null);
  const [pathEditing, setPathEditing] = useState(false);
  const [pathInput, setPathInput] = useState('');
  const pathInputRef = useRef(null);
  const pageRef = useRef(0);
  const sentinelRef = useRef(null);
  const loadingRef = useRef(false);
  // 用 ref 存储最新的 currentDir 和 searchDebounced，避免 loadPage 闭包问题
  const latestParamsRef = useRef({ currentDir: null, searchDebounced: '' });
  latestParamsRef.current = { currentDir, searchDebounced };

  // 迁移相关状态
  const [migrateDialog, setMigrateDialog] = useState({ open: false, ids: [] });
  const [migrating, setMigrating] = useState(false);
  const [migrationResult, setMigrationResult] = useState(null);
  const [targetChannel, setTargetChannel] = useState('');
  const [availableChannels, setAvailableChannels] = useState([]);

  const handleSearchChange = (e) => {
    setSearchInput(e.target.value);
  };

  const loadPage = useCallback(async (pageNum, append) => {
    if (loadingRef.current) return;
    loadingRef.current = true;
    setLoading(true);
    setError(null);
    try {
      const { currentDir: dir, searchDebounced: search } = latestParamsRef.current;
      const params = { page: pageNum, pageSize: PAGE_SIZE };
      if (dir) params.directory = dir;
      if (search) params.search = search;
      const res = await FileDocs.list(params);
      if (res.code === 0 && res.data) {
        const list = res.data.list || [];
        const tot = res.data.pagination?.total || 0;
        setData(prev => append ? [...prev, ...list] : list);
        setTotal(tot);
        const loaded = append ? (pageNum - 1) * PAGE_SIZE + list.length : list.length;
        setHasMore(loaded < tot);
        pageRef.current = pageNum;
      }
    } catch (err) {
      setError('获取文件列表失败');
      console.error(err);
    } finally {
      setLoading(false);
      loadingRef.current = false;
    }
  }, []); // 空依赖，通过 ref 获取最新参数

  const fetchDirectories = useCallback(async () => {
    try {
      const res = await DirectoryDocs.list({ type: 'flat' });
      if (res.code === 0 && res.data) {
        const allDirs = res.data.list || res.data || [];
        const parentPath = currentDir || '/';
        const children = allDirs.filter(d => {
          if (d.path === parentPath) return false;
          const prefix = parentPath === '/' ? '/' : parentPath + '/';
          if (!d.path.startsWith(prefix)) return false;
          const suffix = d.path.slice(prefix.length);
          return suffix.length > 0 && !suffix.includes('/');
        });
        children.sort((a, b) => a.name.localeCompare(b.name));
        setDirectories(children);
      }
    } catch (err) {
      console.error('获取目录失败', err);
      setDirectories([]);
    }
  }, [currentDir]);

  // 搜索或目录变化时重置并加载第一页
  useEffect(() => {
    setData([]);
    setHasMore(false);
    setSelected(new Set());
    pageRef.current = 0;
    loadPage(1, false);
    fetchDirectories();
  }, [searchDebounced, currentDir]); // eslint-disable-line react-hooks/exhaustive-deps

  // 无限滚动 sentinel
  useEffect(() => {
    const el = sentinelRef.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting && !loadingRef.current) {
          setHasMore(more => {
            if (more) loadPage(pageRef.current + 1, true);
            return more;
          });
        }
      },
      { threshold: 0.1 }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [loadPage]);

  const handleRefresh = () => {
    setData([]);
    setHasMore(false);
    setSelected(new Set());
    pageRef.current = 0;
    loadPage(1, false);
    fetchDirectories();
  };

  const toggleSelect = (id) => {
    setSelected(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const triggerDelete = (ids, label) => setDeleteDialog({ open: true, ids, label });
  const closeDeleteDialog = () => { if (!deleting) setDeleteDialog({ open: false, ids: [], label: '' }); };

  const confirmDelete = async () => {
    if (!deleteDialog.ids.length) return;
    setDeleting(true);
    try {
      if (deleteDialog.ids.length === 1) {
        await FileDocs.delete(deleteDialog.ids[0]);
      } else {
        await FileDocs.batch({ action: 'delete', ids: deleteDialog.ids });
      }
      setDeleteDialog({ open: false, ids: [], label: '' });
      setSelected(new Set());
      handleRefresh();
    } catch (e) {
      console.error(e);
    } finally {
      setDeleting(false);
    }
  };

  // 获取可迁移渠道列表
  const fetchWritableChannels = useCallback(async () => {
    try {
      const res = await StorageDocs.list();
      if (res.code === 0) {
        const writable = (res.data.list || []).filter(
          s => s.enabled && s.allowUpload && ['local', 's3', 'huggingface'].includes(s.type)
        );
        setAvailableChannels(writable);
      }
    } catch (err) {
      console.error('获取可写入渠道失败', err);
    }
  }, []);

  // 选中文件时获取渠道列表
  useEffect(() => {
    if (selected.size > 0) fetchWritableChannels();
  }, [selected, fetchWritableChannels]);

  const handleConfirmMigrate = async () => {
    if (!targetChannel || migrateDialog.ids.length === 0) return;
    setMigrating(true);
    setMigrationResult(null);
    try {
      const res = await FileDocs.batch({
        action: 'migrate',
        ids: migrateDialog.ids,
        target_channel: targetChannel
      });
      if (res.code === 0) {
        setMigrationResult(res.data);
        setSelected(new Set());
        setTimeout(handleRefresh, 1000);
      } else {
        setMigrationResult({ success: 0, failed: migrateDialog.ids.length, skipped: 0, errors: [{ reason: res.message }] });
      }
    } catch (e) {
      console.error(e);
      setMigrationResult({ success: 0, failed: migrateDialog.ids.length, skipped: 0, errors: [{ reason: '网络错误' }] });
    } finally {
      setMigrating(false);
    }
  };

  const breadcrumbs = currentDir ? currentDir.split('/').filter(Boolean) : [];

  const navigateToDir = (path) => {
    setCurrentDir(path || null);
    setSearchInput('');
    setPathEditing(false);
  };

  const startPathEdit = () => {
    setPathInput(currentDir || '/');
    setPathEditing(true);
    setTimeout(() => pathInputRef.current?.focus(), 0);
  };

  const commitPathEdit = () => {
    const raw = pathInput.trim();
    const normalized = raw === '/' || raw === '' ? null : (raw.startsWith('/') ? raw : '/' + raw);
    navigateToDir(normalized);
  };

  const cancelPathEdit = () => setPathEditing(false);

  const handleViewModeChange = (_, val) => {
    if (!val) return;
    setViewMode(val);
    localStorage.setItem('pref_view_mode', val);
  };

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, height: '100%' }}>
      {/* 顶部工具栏：面包屑（左）+ 操作区（右） */}
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexShrink: 0, flexWrap: 'wrap' }}>
        {/* 左侧路径栏：点击进入编辑，回车/失焦确认 */}
        {pathEditing ? (
          <TextField
            inputRef={pathInputRef}
            size="small"
            value={pathInput}
            onChange={(e) => setPathInput(e.target.value)}
            onBlur={commitPathEdit}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commitPathEdit();
              if (e.key === 'Escape') cancelPathEdit();
            }}
            sx={{ flex: 1, minWidth: 0 }}
            autoFocus
          />
        ) : (
          <Box
            onClick={startPathEdit}
            sx={{
              flex: 1, minWidth: 0,
              cursor: 'text',
              display: 'flex', alignItems: 'center',
              px: 1.5, py: 1,
              border: 1, borderColor: 'divider', borderRadius: BORDER_RADIUS.sm,
              bgcolor: 'background.paper',
              transition: 'border-color 0.15s, box-shadow 0.15s',
              '&:hover': { borderColor: 'primary.main', boxShadow: '0 0 0 1px theme.palette.primary.main' },
            }}
          >
            <Breadcrumbs separator={<NavigateNextIcon fontSize="small" />} sx={{ fontSize: 14 }}>
              <Link component="button" underline="hover"
                color={currentDir ? 'inherit' : 'text.primary'}
                onClick={(e) => { e.stopPropagation(); navigateToDir(null); }}
                sx={{ cursor: 'pointer', fontWeight: !currentDir ? 'bold' : 'normal', fontSize: 14, border: 'none', background: 'none', p: 0 }}
              >根目录</Link>
              {breadcrumbs.map((seg, i) => {
                const path = '/' + breadcrumbs.slice(0, i + 1).join('/');
                const isLast = i === breadcrumbs.length - 1;
                return isLast ? (
                  <Typography key={path} fontSize={14} fontWeight="bold" color="text.primary" noWrap>{seg}</Typography>
                ) : (
                  <Link key={path} component="button" underline="hover" color="inherit"
                    onClick={(e) => { e.stopPropagation(); navigateToDir(path); }}
                    sx={{ cursor: 'pointer', fontSize: 14, border: 'none', background: 'none', p: 0 }}
                  >{seg}</Link>
                );
              })}
            </Breadcrumbs>
          </Box>
        )}

        {/* 右侧操作区 */}
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexShrink: 0 }}>
          <TextField
            size="small"
            placeholder="搜索..."
            value={searchInput}
            onChange={handleSearchChange}
            sx={{ width: 160, bgcolor: 'background.paper' }}
            slotProps={{
              input: {
                startAdornment: (
                  <InputAdornment position="start">
                    <SearchIcon fontSize="small" />
                  </InputAdornment>
                )
              }
            }}
          />
          <Divider orientation="vertical" flexItem />
          <ToggleButtonGroup value={viewMode} exclusive onChange={handleViewModeChange} size="small"
            sx={{ bgcolor: 'background.paper' }}>
            <ToggleButton value="masonry" aria-label="瀑布流">
              <Tooltip title="瀑布流"><ViewModuleIcon fontSize="small" /></Tooltip>
            </ToggleButton>
            <ToggleButton value="list" aria-label="详细列表">
              <Tooltip title="详细列表"><ViewListIcon fontSize="small" /></Tooltip>
            </ToggleButton>
          </ToggleButtonGroup>
          <IconButton size="small" onClick={handleRefresh} disabled={loading}>
            <Tooltip title="刷新"><RefreshIcon fontSize="small" /></Tooltip>
          </IconButton>
        </Box>
      </Box>

      {/* 批量选中工具栏（底部居中浮出） */}
      {selected.size > 0 && (
        <Paper elevation={6} sx={{
          position: 'fixed', bottom: 28, left: '50%', transform: 'translateX(-50%)',
          zIndex: 1200, px: 3, py: 1.5,
          display: 'flex', alignItems: 'center', gap: 1.5,
          borderRadius: BORDER_RADIUS.lg, whiteSpace: 'nowrap',
        }}>
          <Typography variant="body2" fontWeight="medium">已选 {selected.size} 项</Typography>
          <Divider orientation="vertical" flexItem />
          {availableChannels.length > 0 && (
            <Button size="small" color="primary" variant="outlined" startIcon={<CompareArrowsIcon />}
              onClick={() => setMigrateDialog({ open: true, ids: [...selected] })}>
              迁移渠道
            </Button>
          )}
          <Button size="small" color="error" variant="contained" startIcon={<DeleteIcon />}
            onClick={() => triggerDelete([...selected], `${selected.size} 个文件`)}>
            批量删除
          </Button>
          <Button size="small" onClick={() => setSelected(new Set())}>取消选择</Button>
        </Paper>
      )}

      {error && <Alert severity="error" sx={{ flexShrink: 0 }}>{error}</Alert>}

      {/* 内容滚动区 */}
      <Box sx={{ flexGrow: 1, overflow: 'auto', minHeight: 0 }}>
        {/* 目录卡片 */}
        {directories.length > 0 && (
          <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1.5, mb: 2 }}>
            {directories.map(dir => (
              <Paper key={dir.path} variant="outlined"
                onClick={() => navigateToDir(dir.path)}
                sx={{ display: 'flex', alignItems: 'center', gap: 1, px: 2, py: 1.5,
                  cursor: 'pointer', borderRadius: BORDER_RADIUS.md,
                  '&:hover': { bgcolor: 'action.hover', borderColor: 'primary.main' },
                  transition: 'all 0.15s' }}
              >
                <FolderIcon color="warning" />
                <Typography variant="body2" fontWeight="medium">{dir.name}</Typography>
              </Paper>
            ))}
          </Box>
        )}

        {/* 首次加载 */}
        {loading && data.length === 0 && (
          <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}>
            <CircularProgress />
          </Box>
        )}

        {/* 空状态 */}
        {!loading && data.length === 0 && (
          <Box sx={{ textAlign: 'center', py: 6, color: 'text.secondary' }}>
            <Typography>暂无文件</Typography>
          </Box>
        )}

        {/* 优化：两个视图都保留在 DOM 中，只通过 display:none 隐藏未选中的
            这样切换视图时不会销毁重建 DOM，图片不会重新加载，切换更流畅 */}
        {data.length > 0 && (
          <>
            <Box sx={{ display: viewMode === 'masonry' ? 'block' : 'none' }}>
              <ImageList variant="masonry" cols={cols} gap={12}>
                {data.map(item => (
                  <MasonryImageItem
                    key={item.id}
                    item={item}
                    isSelected={selected.has(item.id)}
                    toggleSelect={() => toggleSelect(item.id)}
                    triggerDelete={triggerDelete}
                  />
                ))}
              </ImageList>
            </Box>

            <Box sx={{ display: viewMode === 'list' ? 'block' : 'none' }}>
              <Table size="small" stickyHeader>
                <TableHead>
                  <TableRow>
                    <TableCell padding="checkbox">
                      <Checkbox size="small"
                        indeterminate={selected.size > 0 && selected.size < data.length}
                        checked={data.length > 0 && selected.size === data.length}
                        onChange={() => {
                          if (selected.size === data.length) setSelected(new Set());
                          else setSelected(new Set(data.map(d => d.id)));
                        }} />
                    </TableCell>
                    <TableCell sx={{ width: 64 }}>预览</TableCell>
                    <TableCell>文件名</TableCell>
                    <TableCell>渠道类型</TableCell>
                    <TableCell>渠道名称</TableCell>
                    <TableCell>大小</TableCell>
                    <TableCell>目录</TableCell>
                    <TableCell>上传时间</TableCell>
                    <TableCell align="right">操作</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {data.map(item => (
                    <TableRow key={item.id} hover selected={selected.has(item.id)}>
                      <TableCell padding="checkbox">
                        <Checkbox size="small" checked={selected.has(item.id)}
                          onChange={() => toggleSelect(item.id)} />
                      </TableCell>
                      <TableCell sx={{ width: 64, p: 0.5 }}>
                        <Box
                          component="img"
                          src={`/${item.id}`}
                          alt={item.original_name || item.file_name}
                          loading="lazy"
                          sx={{ width: 48, height: 48, objectFit: 'cover', borderRadius: BORDER_RADIUS.sm, display: 'block' }}
                        />
                      </TableCell>
                      <TableCell sx={{ maxWidth: 280 }}>
                        <Typography variant="body2" noWrap>{item.original_name || item.file_name}</Typography>
                      </TableCell>
                      <TableCell>
                        <Chip
                          label={channelTypeLabel(item.storage_channel)}
                          size="small"
                          variant="outlined"
                          sx={{ fontSize: 11 }}
                        />
                      </TableCell>
                      <TableCell>
                        <Typography variant="body2" color="text.secondary">{parseChannelName(item.storage_config)}</Typography>
                      </TableCell>
                      <TableCell>
                        <Typography variant="body2" color="text.secondary" noWrap>{fmtSize(item.size)}</Typography>
                      </TableCell>
                      <TableCell>
                        <Typography variant="body2" color="text.secondary">{item.directory || '/'}</Typography>
                      </TableCell>
                      <TableCell>
                        <Typography variant="body2" color="text.secondary">{fmtDate(item.created_at)}</Typography>
                      </TableCell>
                      <TableCell align="right">
                        <Tooltip title="删除">
                          <IconButton size="small" color="error"
                            onClick={() => triggerDelete([item.id], item.original_name || item.file_name)}>
                            <DeleteIcon fontSize="small" />
                          </IconButton>
                        </Tooltip>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </Box>
          </>
        )}

        {/* 无限滚动 sentinel */}
        <Box ref={sentinelRef} sx={{ py: 1, display: 'flex', justifyContent: 'center' }}>
          {loading && data.length > 0 && <CircularProgress size={24} />}
          {!hasMore && data.length > 0 && (
            <Typography variant="caption" color="text.secondary">共 {total} 个文件，已全部加载</Typography>
          )}
        </Box>
      </Box>

      {/* 删除确认弹窗 */}
      <ConfirmDialog
        open={deleteDialog.open}
        title="确认删除"
        onClose={closeDeleteDialog}
        onConfirm={confirmDelete}
        confirmLoading={deleting}
        confirmText="确认删除"
      >
        确定要彻底删除 <b>{deleteDialog.label}</b> 吗？<br />
        此操作将同时从数据库和云存储中永久移除，且不可恢复。
      </ConfirmDialog>

      {/* 迁移渠道弹窗 */}
      <Dialog open={migrateDialog.open} onClose={() => !migrating && setMigrateDialog({ open: false, ids: [] })} maxWidth="sm" fullWidth>
        <DialogTitle>迁移文件渠道</DialogTitle>
        <DialogContent dividers>
          <Typography gutterBottom>
            将 <b>{migrateDialog.ids.length}</b> 个文件迁移到指定渠道：
          </Typography>
          <FormControl fullWidth size="small" sx={{ mt: 2 }}>
            <InputLabel>目标渠道</InputLabel>
            <Select value={targetChannel} label="目标渠道"
              onChange={(e) => setTargetChannel(e.target.value)} disabled={migrating}>
              {availableChannels.map((ch) => (
                <MenuItem key={ch.id} value={ch.id}>
                  {ch.name} ({ch.type})
                </MenuItem>
              ))}
            </Select>
          </FormControl>
          {migrating && (
            <Box sx={{ mt: 2 }}>
              <LinearProgress />
              <Typography variant="caption" color="text.secondary" sx={{ mt: 0.5, display: 'block' }}>
                正在迁移 {migrateDialog.ids.length} 个文件...
              </Typography>
            </Box>
          )}
          {migrationResult && !migrating && (
            <Alert severity={migrationResult.failed > 0 ? 'warning' : 'success'} sx={{ mt: 2 }}>
              成功: {migrationResult.success} | 失败: {migrationResult.failed} | 跳过: {migrationResult.skipped}
              {migrationResult.errors.length > 0 && (
                <Typography variant="caption" component="div" sx={{ mt: 1 }}>
                  失败详情: {migrationResult.errors.map(e => `${e.id}: ${e.reason}`).join(', ')}
                </Typography>
              )}
            </Alert>
          )}
          <Alert severity="info" sx={{ mt: 2 }}>
            迁移成功后源文件将保留作为备份，不会被删除。
          </Alert>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setMigrateDialog({ open: false, ids: [] })} disabled={migrating}>
            {migrationResult ? '关闭' : '取消'}
          </Button>
          {!migrationResult && (
            <Button variant="contained" onClick={handleConfirmMigrate} disabled={migrating || !targetChannel}>
              {migrating ? <CircularProgress size={18} color="inherit" /> : '开始迁移'}
            </Button>
          )}
        </DialogActions>
      </Dialog>
    </Box>
  );
}
