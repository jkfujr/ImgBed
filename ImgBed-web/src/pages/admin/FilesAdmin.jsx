import { useEffect, useState, useCallback, useRef } from 'react';
import {
  Box, Typography, Checkbox, Chip,
  IconButton, Tooltip, Dialog, DialogTitle, DialogContent,
  DialogActions, Button, CircularProgress,
  Paper, Breadcrumbs, Link, ToggleButtonGroup, ToggleButton, Divider,
  Table, TableHead, TableBody, TableRow, TableCell, Alert,
  FormControl, InputLabel, Select, MenuItem, LinearProgress,
  useTheme, useMediaQuery, Menu, ListItemIcon, TextField
} from '@mui/material';
import DeleteIcon from '@mui/icons-material/Delete';
import InfoIcon from '@mui/icons-material/Info';
import RefreshIcon from '@mui/icons-material/Refresh';
import FolderIcon from '@mui/icons-material/Folder';
import NavigateNextIcon from '@mui/icons-material/NavigateNext';
import ViewModuleIcon from '@mui/icons-material/ViewModule';
import ViewListIcon from '@mui/icons-material/ViewList';
import CompareArrowsIcon from '@mui/icons-material/CompareArrows';
import ImageIcon from '@mui/icons-material/Image';
import ContentPasteIcon from '@mui/icons-material/ContentPaste';
import CreateNewFolderIcon from '@mui/icons-material/CreateNewFolder';
import StorageIcon from '@mui/icons-material/Storage';
import MasonryImageItem from '../../components/admin/MasonryImageItem';
import Masonry from '@mui/lab/Masonry';
import ImageDetailLightbox from '../../components/admin/ImageDetailLightbox';
import ConfirmDialog from '../../components/common/ConfirmDialog';
import PasteUploadDialog from '../../components/common/PasteUploadDialog';
import CreateFolderDialog from '../../components/common/CreateFolderDialog';
import { useUserPreference } from '../../hooks/useUserPreference';
import { fmtDate, fmtSize, parseChannelName, channelTypeLabel, parseTags } from '../../utils/formatters';
import { FileDocs, DirectoryDocs, StorageDocs } from '../../api';
import { useNavigate } from 'react-router-dom';
import { useRefresh } from '../../contexts/RefreshContext';
import { useUpload } from '../../hooks/useUpload';
import { useCreateDirectory } from '../../hooks/useCreateDirectory';

import { DEFAULT_PAGE_SIZE, BORDER_RADIUS } from '../../utils/constants';

const PAGE_SIZE = DEFAULT_PAGE_SIZE;

export default function FilesAdmin() {
  const { refreshTrigger } = useRefresh();
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
  const [loading, setLoading] = useState(true);
  const [hasMore, setHasMore] = useState(false);
  const [directories, setDirectories] = useState([]);
  const [currentDir, setCurrentDir] = useState(null);
  const [selected, setSelected] = useState(new Set());
  const [deleteDialog, setDeleteDialog] = useState({ open: false, ids: [], label: '' });
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState(null);
  const [pathEditing, setPathEditing] = useState(false);
  const [pathInput, setPathInput] = useState('');
  const pathInputRef = useRef(null);
  const pageRef = useRef(0);
  const sentinelRef = useRef(null);

  // 迁移相关状态
  const [migrateDialog, setMigrateDialog] = useState({ open: false, ids: [] });
  const [migrating, setMigrating] = useState(false);
  const [migrationResult, setMigrationResult] = useState(null);
  const [targetChannel, setTargetChannel] = useState('');
  const [availableChannels, setAvailableChannels] = useState([]);

  // 新建菜单相关状态
  const navigate = useNavigate();
  const [createMenuAnchor, setCreateMenuAnchor] = useState(null);
  const [pasteDialogOpen, setPasteDialogOpen] = useState(false);
  const [uploadMode, setUploadMode] = useState('file'); // 'file' | 'folder'
  const [folderDialogOpen, setFolderDialogOpen] = useState(false);

  // 详情弹窗相关状态
  const [detailOpen, setDetailOpen] = useState(false);
  const [selectedItem, setSelectedItem] = useState(null);

  const { createDirectory } = useCreateDirectory();

  const handleOpenDetail = useCallback((item) => {
    setSelectedItem(item);
    setDetailOpen(true);
  }, []);

  const handleCloseDetail = () => {
    setDetailOpen(false);
    setSelectedItem(null);
  };

  const clearSelection = useCallback(() => {
    setSelected(new Set());
  }, []);

  const selectAll = useCallback(() => {
    setSelected(new Set(data.map((d) => d.id)));
  }, [data]);

  const resetDirectoryView = useCallback(() => {
    setData([]);
    setDirectories([]);
    setHasMore(false);
    clearSelection();
    setError(null);
    pageRef.current = 0;
  }, [clearSelection]);

  const loadDirectoryData = useCallback(async ({ showLoading = false } = {}) => {
    if (showLoading) {
      setLoading(true);
    }
    resetDirectoryView();

    try {
      // 并行加载文件列表和目录列表
      const [pageRes, dirsRes] = await Promise.all([
        (async () => {
          const params = { page: 1, pageSize: PAGE_SIZE };
          if (currentDir) params.directory = currentDir;
          return FileDocs.list(params);
        })(),
        DirectoryDocs.list({ type: 'flat' })
      ]);

      // 处理文件列表
      if (pageRes.code === 0 && pageRes.data) {
        const list = pageRes.data.list || [];
        setData(list);
        setTotal(pageRes.data.pagination?.total || 0);
        setHasMore(list.length < (pageRes.data.pagination?.total || 0));
        pageRef.current = 1;
      }

      // 处理目录树
      if (dirsRes.code === 0 && dirsRes.data) {
        const allDirs = dirsRes.data.list || dirsRes.data || [];
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
      console.error('加载失败', err);
      setError('加载失败');
    } finally {
      if (showLoading) {
        setLoading(false);
      }
    }
  }, [currentDir, resetDirectoryView]);

  // 搜索或目录变化时重置并加载第一页
  useEffect(() => {
    loadDirectoryData({ showLoading: true });
  }, [loadDirectoryData]);

  // 监听外部刷新触发
  useEffect(() => {
    if (refreshTrigger > 0) {
      loadDirectoryData();
    }
  }, [refreshTrigger, loadDirectoryData]);

  const handleRefresh = useCallback(() => {
    loadDirectoryData({ showLoading: true });
  }, [loadDirectoryData]);

  const refreshAfterMutation = useCallback(() => {
    clearSelection();
    handleRefresh();
  }, [clearSelection, handleRefresh]);

  const { upload } = useUpload({
    refreshMode: 'callback',
    onRefresh: handleRefresh
  });

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
      refreshAfterMutation();
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

  // 组件挂载时加载一次可迁移渠道列表（渠道配置不经常变化）
  useEffect(() => {
    fetchWritableChannels();
  }, [fetchWritableChannels]);

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
        refreshAfterMutation();
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

  const handleCreateMenuClose = () => {
    setCreateMenuAnchor(null);
  };

  const runAfterCreateMenuClose = (action) => {
    handleCreateMenuClose();
    action();
  };

  const handleUploadImage = () => {
    setUploadMode('file');
    setPasteDialogOpen(true);
  };

  const handleUploadDirectory = () => {
    setUploadMode('folder');
    setPasteDialogOpen(true);
  };

  const handlePasteUploadFile = async (file) => {
    try {
      const result = await upload(file, { directory: currentDir || undefined });
      if (!result.success) {
        console.error('上传失败:', result.error);
      }
    } catch (err) {
      console.error('上传失败:', err);
    }
  };

  const handleCreateFolderConfirm = async (folderPath) => {
    try {
      const result = await createDirectory(folderPath, { currentPath: currentDir });
      if (!result.success) {
        console.error('创建文件夹失败:', result.error);
      }
      handleRefresh();
    } catch (err) {
      console.error('创建文件夹失败:', err);
    }
  };

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, height: '100%' }}>
      {/* 顶部工具栏：路径栏（左）+ 操作区（右） */}
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
          <Button size="small" onClick={clearSelection}>取消选择</Button>
        </Paper>
      )}

      {error && <Alert severity="error" sx={{ flexShrink: 0 }}>{error}</Alert>}

      {/* 新建菜单 */}
      <Menu
        anchorEl={createMenuAnchor}
        open={Boolean(createMenuAnchor)}
        onClose={handleCreateMenuClose}
        transformOrigin={{ horizontal: 'left', vertical: 'top' }}
        anchorOrigin={{ horizontal: 'left', vertical: 'bottom' }}
        slotProps={{
          paper: {
            elevation: 3,
            sx: { mt: 1, minWidth: 180, borderRadius: BORDER_RADIUS.md }
          }
        }}
      >
        <MenuItem onClick={() => runAfterCreateMenuClose(() => handleUploadImage())}>
          <ListItemIcon><ImageIcon fontSize="small" /></ListItemIcon>
          上传图片
        </MenuItem>
        <MenuItem onClick={() => runAfterCreateMenuClose(() => handleUploadDirectory())}>
          <ListItemIcon><FolderIcon fontSize="small" /></ListItemIcon>
          上传目录
        </MenuItem>
        <MenuItem onClick={() => runAfterCreateMenuClose(() => setPasteDialogOpen(true))}>
          <ListItemIcon><ContentPasteIcon fontSize="small" /></ListItemIcon>
          剪贴板上传
        </MenuItem>
        <Divider />
        <MenuItem onClick={() => runAfterCreateMenuClose(() => setFolderDialogOpen(true))}>
          <ListItemIcon><CreateNewFolderIcon fontSize="small" /></ListItemIcon>
          创建文件夹
        </MenuItem>
        <MenuItem onClick={() => runAfterCreateMenuClose(() => navigate('/admin/storage-channels'))}>
          <ListItemIcon><StorageIcon fontSize="small" /></ListItemIcon>
          新增渠道
        </MenuItem>
      </Menu>

      {/* 统一上传弹窗 */}
      <PasteUploadDialog
        open={pasteDialogOpen}
        onClose={() => setPasteDialogOpen(false)}
        onUpload={handlePasteUploadFile}
        allowFolder={uploadMode === 'folder'}
      />

      {/* 创建文件夹弹窗 */}
      <CreateFolderDialog
        open={folderDialogOpen}
        onClose={() => setFolderDialogOpen(false)}
        onConfirm={handleCreateFolderConfirm}
      />

      {/* 内容滚动区 */}
      <Box sx={{ flexGrow: 1, overflow: 'auto', overflowX: 'hidden', minHeight: 0 }}>
        {/* 首次加载 */}
        {loading && data.length === 0 && (
          <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}>
            <CircularProgress />
          </Box>
        )}

        {/* 空状态（无文件且无子目录时显示） */}
        {!loading && data.length === 0 && directories.length === 0 && (
          <Box sx={{ textAlign: 'center', py: 6, color: 'text.secondary' }}>
            <Typography>暂无文件</Typography>
          </Box>
        )}

        {/* 优化：两个视图都保留在 DOM 中，只通过 display:none 隐藏未选中的
            这样切换视图时不会销毁重建 DOM，图片不会重新加载，切换更流畅 */}
        {(data.length > 0 || directories.length > 0) && (
          <>
            <Box sx={{ display: viewMode === 'masonry' ? 'block' : 'none' }}>
              <Masonry
                columns={cols}
                spacing={1.5}
                defaultColumns={cols}
                defaultHeight={800}
                sx={{ alignContent: 'flex-start' }}
              >
                {directories.map(dir => (
                  <Paper key={`dir-${dir.path}`} variant="outlined"
                    onClick={() => navigateToDir(dir.path)}
                    sx={{
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: 1,
                      p: 3,
                      aspectRatio: '1',
                      cursor: 'pointer',
                      borderRadius: BORDER_RADIUS.md,
                      bgcolor: 'background.paper',
                      '&:hover': { bgcolor: 'action.hover', borderColor: 'primary.main' },
                      transition: 'all 0.15s'
                    }}
                  >
                    <FolderIcon color="warning" sx={{ fontSize: 48 }} />
                    <Typography variant="body2" fontWeight="medium" textAlign="center" noWrap sx={{ width: '100%', px: 1 }}>
                      {dir.name}
                    </Typography>
                  </Paper>
                ))}
                {data.map(item => (
                  <MasonryImageItem
                    key={item.id}
                    item={item}
                    isSelected={selected.has(item.id)}
                    toggleSelect={toggleSelect}
                    triggerDelete={triggerDelete}
                    onOpenDetail={handleOpenDetail}
                  />
                ))}
              </Masonry>
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
                          if (selected.size === data.length) clearSelection();
                          else selectAll();
                        }} />
                    </TableCell>
                    <TableCell sx={{ width: 64 }}>预览</TableCell>
                    <TableCell>文件名</TableCell>
                    <TableCell>标签</TableCell>
                    <TableCell>渠道类型</TableCell>
                    <TableCell>渠道名称</TableCell>
                    <TableCell>大小</TableCell>
                    <TableCell>目录</TableCell>
                    <TableCell>上传时间</TableCell>
                    <TableCell align="right">操作</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {/* 列表视图中的文件夹行 */}
                  {viewMode === 'list' && directories.map(dir => (
                    <TableRow key={`dir-${dir.path}`} hover
                      onClick={() => navigateToDir(dir.path)}
                      sx={{ cursor: 'pointer', '&:hover': { bgcolor: 'action.hover' } }}
                    >
                      <TableCell padding="checkbox" />
                      <TableCell sx={{ width: 64, p: 0.5 }}>
                        <Box sx={{ width: 48, height: 48, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                          <FolderIcon color="warning" sx={{ fontSize: 32 }} />
                        </Box>
                      </TableCell>
                      <TableCell sx={{ maxWidth: 280 }}>
                        <Typography variant="body2" fontWeight="medium">{dir.name}</Typography>
                      </TableCell>
                      <TableCell><Typography variant="caption" color="text.secondary">-</Typography></TableCell>
                      <TableCell><Typography variant="caption" color="text.secondary">-</Typography></TableCell>
                      <TableCell><Typography variant="caption" color="text.secondary">-</Typography></TableCell>
                      <TableCell><Typography variant="caption" color="text.secondary">-</Typography></TableCell>
                      <TableCell>
                        <Typography variant="body2" color="text.secondary">{dir.path}</Typography>
                      </TableCell>
                      <TableCell><Typography variant="caption" color="text.secondary">-</Typography></TableCell>
                      <TableCell align="right" />
                    </TableRow>
                  ))}
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
                          sx={{
                            width: 48,
                            height: 48,
                            objectFit: 'cover',
                            borderRadius: BORDER_RADIUS.sm,
                            display: 'block',
                            cursor: 'pointer',
                            '&:hover': { opacity: 0.8 }
                          }}
                          onClick={() => handleOpenDetail(item)}
                        />
                      </TableCell>
                      <TableCell sx={{ maxWidth: 280 }}>
                        <Typography variant="body2" noWrap>{item.original_name || item.file_name}</Typography>
                      </TableCell>
                      <TableCell>
                        <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
                          {parseTags(item.tags).length > 0 ? (
                            parseTags(item.tags).map((tag, idx) => (
                              <Chip key={idx} label={tag} size="small" variant="outlined" color="primary" sx={{ fontSize: 10, height: 20 }} />
                            ))
                          ) : (
                            <Typography variant="caption" color="text.secondary">-</Typography>
                          )}
                        </Box>
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
                        <Box sx={{ display: 'flex', justifyContent: 'flex-end', gap: 0.5 }}>
                          <Tooltip title="详情">
                            <IconButton size="small" color="primary" onClick={() => handleOpenDetail(item)}>
                              <InfoIcon fontSize="small" />
                            </IconButton>
                          </Tooltip>
                          <Tooltip title="删除">
                            <IconButton size="small" color="error"
                              onClick={() => triggerDelete([item.id], item.original_name || item.file_name)}>
                              <DeleteIcon fontSize="small" />
                            </IconButton>
                          </Tooltip>
                        </Box>
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

      {/* 文件详情弹窗 (全屏 Lightbox 风格) */}
      {/* 文件详情弹窗 */}
      <ImageDetailLightbox
        open={detailOpen}
        item={selectedItem}
        onClose={handleCloseDetail}
        onDelete={triggerDelete}
      />

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
