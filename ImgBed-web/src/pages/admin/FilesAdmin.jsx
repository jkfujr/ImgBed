import React, { useEffect, useState, useCallback, useRef } from 'react';
import {
  Box, Typography, ImageList, ImageListItem, Checkbox,
  IconButton, Tooltip, Dialog, DialogTitle, DialogContent,
  DialogActions, Button, CircularProgress, TextField, InputAdornment,
  Paper, Breadcrumbs, Link, TablePagination, useMediaQuery, useTheme, Alert
} from '@mui/material';
import DeleteIcon from '@mui/icons-material/Delete';
import SearchIcon from '@mui/icons-material/Search';
import RefreshIcon from '@mui/icons-material/Refresh';
import FolderIcon from '@mui/icons-material/Folder';
import NavigateNextIcon from '@mui/icons-material/NavigateNext';
import { FileDocs, DirectoryDocs } from '../../api';

export default function FilesAdmin() {
  const theme = useTheme();
  const isXl = useMediaQuery(theme.breakpoints.up('xl'));
  const isLg = useMediaQuery(theme.breakpoints.up('lg'));
  const isMd = useMediaQuery(theme.breakpoints.up('md'));

  const prefCols = parseInt(localStorage.getItem('pref_masonry_cols') || '0');
  const autoCols = isXl ? 5 : isLg ? 4 : isMd ? 3 : 2;
  const cols = prefCols > 0 ? prefCols : autoCols;

  const prefPageSize = parseInt(localStorage.getItem('pref_page_size') || '20');

  const [data, setData] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [rowsPerPage, setRowsPerPage] = useState(prefPageSize);
  const [loading, setLoading] = useState(true);
  const [directories, setDirectories] = useState([]);
  const [currentDir, setCurrentDir] = useState(null);
  const [selected, setSelected] = useState(new Set());
  const [hoveredId, setHoveredId] = useState(null);
  const [searchInput, setSearchInput] = useState('');
  const [searchDebounced, setSearchDebounced] = useState('');
  const [deleteDialog, setDeleteDialog] = useState({ open: false, ids: [], label: '' });
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState(null);
  const debounceRef = useRef(null);

  const handleSearchChange = (e) => {
    const val = e.target.value;
    setSearchInput(val);
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      setSearchDebounced(val);
      setPage(0);
    }, 300);
  };

  const fetchFiles = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = { page: page + 1, pageSize: rowsPerPage };
      if (currentDir) params.directory = currentDir;
      if (searchDebounced) params.search = searchDebounced;
      const res = await FileDocs.list(params);
      if (res.code === 0 && res.data) {
        setData(res.data.list || []);
        setTotal(res.data.pagination?.total || 0);
      }
    } catch (err) {
      setError('获取文件列表失败');
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, [page, rowsPerPage, currentDir, searchDebounced]);

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

  useEffect(() => {
    setSelected(new Set());
    fetchFiles();
    fetchDirectories();
  }, [fetchFiles, fetchDirectories]);

  const handleChangePage = (_, newPage) => setPage(newPage);
  const handleChangeRowsPerPage = (e) => {
    setRowsPerPage(parseInt(e.target.value, 10));
    setPage(0);
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
      fetchFiles();
    } catch (e) {
      console.error(e);
    } finally {
      setDeleting(false);
    }
  };

  const breadcrumbs = currentDir ? currentDir.split('/').filter(Boolean) : [];

  const navigateToDir = (path) => {
    setCurrentDir(path || null);
    setPage(0);
    setSelected(new Set());
    setSearchInput('');
    setSearchDebounced('');
  };

  const fmtDate = (str) => {
    if (!str) return '-';
    return new Date(str).toLocaleString('zh-CN', { dateStyle: 'short', timeStyle: 'short' });
  };

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, height: '100%' }}>
      {/* 顶部工具栏 */}
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
        <TextField
          size="small"
          placeholder="搜索文件名..."
          value={searchInput}
          onChange={handleSearchChange}
          sx={{ flex: 1, maxWidth: 320 }}
          InputProps={{
            startAdornment: (
              <InputAdornment position="start">
                <SearchIcon fontSize="small" />
              </InputAdornment>
            )
          }}
        />
        <Tooltip title="刷新">
          <IconButton onClick={() => { setPage(0); fetchFiles(); fetchDirectories(); }}>
            <RefreshIcon />
          </IconButton>
        </Tooltip>
      </Box>

      {/* 面包屑导航 */}
      <Breadcrumbs separator={<NavigateNextIcon fontSize="small" />} sx={{ fontSize: 14 }}>
        <Link
          component="button"
          underline="hover"
          color={currentDir ? 'inherit' : 'text.primary'}
          onClick={() => navigateToDir(null)}
          sx={{ cursor: 'pointer', fontWeight: !currentDir ? 'bold' : 'normal', fontSize: 14, border: 'none', background: 'none', p: 0 }}
        >
          根目录
        </Link>
        {breadcrumbs.map((seg, i) => {
          const path = '/' + breadcrumbs.slice(0, i + 1).join('/');
          const isLast = i === breadcrumbs.length - 1;
          return isLast ? (
            <Typography key={path} fontSize={14} fontWeight="bold" color="text.primary">{seg}</Typography>
          ) : (
            <Link
              key={path}
              component="button"
              underline="hover"
              color="inherit"
              onClick={() => navigateToDir(path)}
              sx={{ cursor: 'pointer', fontSize: 14, border: 'none', background: 'none', p: 0 }}
            >{seg}</Link>
          );
        })}
      </Breadcrumbs>

      {/* 批量选中工具栏 */}
      {selected.size > 0 && (
        <Paper variant="outlined" sx={{ px: 2, py: 1, display: 'flex', alignItems: 'center', gap: 1, bgcolor: 'primary.50' }}>
          <Typography variant="body2" sx={{ flex: 1 }}>已选 {selected.size} 项</Typography>
          <Button size="small" color="error" variant="contained" startIcon={<DeleteIcon />}
            onClick={() => triggerDelete([...selected], `${selected.size} 个文件`)}>
            批量删除
          </Button>
          <Button size="small" onClick={() => setSelected(new Set())}>取消选择</Button>
        </Paper>
      )}

      {error && <Alert severity="error">{error}</Alert>}

      {/* 内容区 */}
      {loading ? (
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}>
          <CircularProgress />
        </Box>
      ) : (
        <>
          {/* 目录卡片 */}
          {directories.length > 0 && (
            <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1.5, mb: 1 }}>
              {directories.map(dir => (
                <Paper key={dir.path} variant="outlined"
                  onClick={() => navigateToDir(dir.path)}
                  sx={{ display: 'flex', alignItems: 'center', gap: 1, px: 2, py: 1.5,
                    cursor: 'pointer', borderRadius: 2,
                    '&:hover': { bgcolor: 'action.hover', borderColor: 'primary.main' },
                    transition: 'all 0.15s' }}
                >
                  <FolderIcon color="warning" />
                  <Typography variant="body2" fontWeight="medium">{dir.name}</Typography>
                </Paper>
              ))}
            </Box>
          )}

          {/* 图片瀑布流 */}
          {data.length === 0 ? (
            <Box sx={{ textAlign: 'center', py: 6, color: 'text.secondary' }}>
              <Typography>暂无文件</Typography>
            </Box>
          ) : (
            <ImageList variant="masonry" cols={cols} gap={12}>
              {data.map(item => (
                <ImageListItem key={item.id}
                  onMouseEnter={() => setHoveredId(item.id)}
                  onMouseLeave={() => setHoveredId(null)}
                  sx={{ position: 'relative', borderRadius: 2, overflow: 'hidden' }}
                >
                  <img
                    src={`/${item.id}`}
                    alt={item.original_name || item.file_name}
                    loading="lazy"
                    style={{ display: 'block', width: '100%', borderRadius: 8 }}
                  />
                  {/* 左上角复选框 */}
                  <Box sx={{ position: 'absolute', top: 4, left: 4,
                    opacity: (hoveredId === item.id || selected.has(item.id)) ? 1 : 0,
                    transition: 'opacity 0.15s' }}>
                    <Checkbox size="small" checked={selected.has(item.id)}
                      onChange={() => toggleSelect(item.id)}
                      sx={{ bgcolor: 'rgba(255,255,255,0.85)', borderRadius: 1, p: 0.3,
                        '&:hover': { bgcolor: 'white' } }}
                    />
                  </Box>
                  {/* 底部信息条 */}
                  <Box sx={{ position: 'absolute', bottom: 0, left: 0, right: 0,
                    bgcolor: 'rgba(0,0,0,0.55)', color: 'white', px: 1, py: 0.5,
                    display: 'flex', alignItems: 'center',
                    opacity: hoveredId === item.id ? 1 : 0,
                    transition: 'opacity 0.15s' }}>
                    <Box sx={{ flex: 1, overflow: 'hidden' }}>
                      <Typography variant="caption" noWrap sx={{ display: 'block' }}>
                        {item.original_name || item.file_name}
                      </Typography>
                      <Typography variant="caption" sx={{ opacity: 0.75 }}>
                        {fmtDate(item.created_at)}
                      </Typography>
                    </Box>
                    <Tooltip title="删除">
                      <IconButton size="small"
                        sx={{ color: 'white', '&:hover': { color: '#ff6b6b' } }}
                        onClick={() => triggerDelete([item.id], item.original_name || item.file_name)}>
                        <DeleteIcon fontSize="small" />
                      </IconButton>
                    </Tooltip>
                  </Box>
                </ImageListItem>
              ))}
            </ImageList>
          )}

          <TablePagination component="div" count={total} page={page}
            onPageChange={handleChangePage} rowsPerPage={rowsPerPage}
            onRowsPerPageChange={handleChangeRowsPerPage}
            rowsPerPageOptions={[20, 40, 60, 100]}
            labelRowsPerPage="每页数量:"
          />
        </>
      )}

      {/* 删除确认弹窗 */}
      <Dialog open={deleteDialog.open} onClose={closeDeleteDialog}>
        <DialogTitle>确认删除</DialogTitle>
        <DialogContent dividers>
          确定要彻底删除 <b>{deleteDialog.label}</b> 吗？<br />
          此操作将同时从数据库和云存储中永久移除，且不可恢复。
        </DialogContent>
        <DialogActions>
          <Button onClick={closeDeleteDialog} disabled={deleting}>取消</Button>
          <Button color="error" variant="contained" onClick={confirmDelete} disabled={deleting}>
            {deleting ? <CircularProgress size={18} color="inherit" /> : '确认删除'}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
