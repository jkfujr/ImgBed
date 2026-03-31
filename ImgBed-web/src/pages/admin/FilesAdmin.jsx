import React, { useEffect, useState, useCallback } from 'react';
import { 
   Box, Paper, Typography, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, TablePagination,
   IconButton, Tooltip, Link, Chip, Dialog, DialogTitle, DialogContent, DialogActions, Button, CircularProgress
} from '@mui/material';
import DeleteIcon from '@mui/icons-material/Delete';
import EditIcon from '@mui/icons-material/Edit';
import { FileDocs } from '../../api';

export default function FilesAdmin() {
  const [data, setData] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0); // MUI Pagination is 0-indexed
  const [rowsPerPage, setRowsPerPage] = useState(10);
  const [loading, setLoading] = useState(true);

  // 删除对话框状态
  const [deleteDialog, setDeleteDialog] = useState({ open: false, id: null, fileName: '' });
  const [deleting, setDeleting] = useState(false);

  const fetchFiles = useCallback(async () => {
    setLoading(true);
    try {
      // API expected 1-indexed page
      const res = await FileDocs.list({ page: page + 1, pageSize: rowsPerPage });
      if (res.code === 0 && res.data) {
          setData(res.data.records || []);
          setTotal(res.data.total || 0);
      }
    } catch (err) {
      console.error('Failed to fetch files:', err);
    } finally {
      setLoading(false);
    }
  }, [page, rowsPerPage]);

  useEffect(() => {
    fetchFiles();
  }, [fetchFiles]);

  const handleChangePage = (event, newPage) => {
    setPage(newPage);
  };

  const handleChangeRowsPerPage = (event) => {
    setRowsPerPage(parseInt(event.target.value, 10));
    setPage(0);
  };

  const triggerDelete = (item) => {
    setDeleteDialog({ open: true, id: item.id, fileName: item.original_name || item.file_name });
  };

  const confirmDelete = async () => {
    if (!deleteDialog.id) return;
    setDeleting(true);
    try {
       await FileDocs.delete(deleteDialog.id);
       // Reset and fetch
       setDeleteDialog({ open: false, id: null, fileName: '' });
       fetchFiles();
    } catch (e) {
       console.error(e);
       alert('删除由于内部故障失败，见由于网络终端输出');
    } finally {
       setDeleting(false);
    }
  };

  const formatSize = (bytes) => {
      if (bytes === 0) return '0 B';
      const k = 1024;
      const sizes = ['B', 'KB', 'MB', 'GB'];
      const i = Math.floor(Math.log(bytes) / Math.log(k));
      return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  return (
    <Box>
       <Typography variant="h5" fontWeight="bold" gutterBottom color="textPrimary">
           图片档案库
       </Typography>
       
       <Paper sx={{ width: '100%', mb: 2, borderRadius: 2, overflow: 'hidden' }} elevation={2}>
           {/* 加载拦截顶层悬浮 */}
           {loading && (
               <Box sx={{ width: '100%', display: 'flex', justifyContent: 'center', p: 4 }}>
                   <CircularProgress />
               </Box>
           )}

           {!loading && (
             <>
               <TableContainer sx={{ maxHeight: '70vh' }}>
                   <Table stickyHeader size="medium">
                       <TableHead>
                           <TableRow>
                               <TableCell width={80}>缩略图</TableCell>
                               <TableCell>原名称</TableCell>
                               <TableCell>渠道</TableCell>
                               <TableCell>目录</TableCell>
                               <TableCell>体积</TableCell>
                               <TableCell>录入时间</TableCell>
                               <TableCell align="right">操作</TableCell>
                           </TableRow>
                       </TableHead>
                       <TableBody>
                           {data?.map((row) => (
                               <TableRow hover key={row.id}>
                                   <TableCell>
                                       {/* 这里使用公共路由渲染缩略，如果图片极大则可能损耗加载速度 */}
                                       {row.mime_type?.startsWith('image/') ? (
                                            <Box 
                                                component="img" 
                                                src={`/${row.id}`} 
                                                alt="preview"
                                                sx={{ width: 44, height: 44, objectFit: 'cover', borderRadius: 1 }}
                                            />
                                       ) : (
                                            <Box sx={{ width: 44, height: 44, bgcolor: 'divider', borderRadius: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                               MISC
                                            </Box>
                                       )}
                                   </TableCell>
                                   <TableCell>
                                       <Typography variant="body2" sx={{ maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace:'nowrap' }}>
                                          <Link href={`/${row.id}`} target="_blank" underline="hover" color="primary">
                                             {row.original_name || row.file_name}
                                          </Link>
                                       </Typography>
                                   </TableCell>
                                   <TableCell>
                                       <Chip label={row.storage_channel || '未知'} size="small" variant="outlined" color="secondary" />
                                   </TableCell>
                                   <TableCell>{row.directory || '/'}</TableCell>
                                   <TableCell>{formatSize(row.size)}</TableCell>
                                   <TableCell>{new Date(row.created_at).toLocaleString()}</TableCell>
                                   <TableCell align="right">
                                       <Tooltip title="不支持实时修改，未来规划">
                                            <IconButton size="small" color="primary" disabled><EditIcon fontSize="small"/></IconButton>
                                       </Tooltip>
                                       <Tooltip title="物理销毁">
                                            <IconButton size="small" color="error" onClick={() => triggerDelete(row)}>
                                                <DeleteIcon fontSize="small"/>
                                            </IconButton>
                                       </Tooltip>
                                   </TableCell>
                               </TableRow>
                           ))}
                           {data.length === 0 && (
                               <TableRow>
                                   <TableCell colSpan={7} align="center" sx={{ py: 6, color: 'text.secondary' }}>
                                       暂未搜索到任何落库文件
                                   </TableCell>
                               </TableRow>
                           )}
                       </TableBody>
                   </Table>
               </TableContainer>
               <TablePagination
                   component="div"
                   count={total}
                   page={page}
                   onPageChange={handleChangePage}
                   rowsPerPage={rowsPerPage}
                   onRowsPerPageChange={handleChangeRowsPerPage}
                   labelRowsPerPage="每页行数:"
               />
             </>
           )}
       </Paper>

       {/* 删除确认保护模态框 */}
       <Dialog open={deleteDialog.open} onClose={() => setDeleteDialog({...deleteDialog, open: false})}>
           <DialogTitle>彻底双向删除警告</DialogTitle>
           <DialogContent dividers>
               您正在尝试强制物理卸载文件：<b>{deleteDialog.fileName}</b>。
               <br />
               该操作不仅会从当前微型数据库内抹除足迹，还会调用储物引擎向实体云商（如AWS3，Github等等）施加粉碎动作。请确认这不是一场误触。
           </DialogContent>
           <DialogActions>
               <Button onClick={() => setDeleteDialog({...deleteDialog, open: false})} disabled={deleting}>中止操作</Button>
               <Button color="error" variant="contained" onClick={confirmDelete} disabled={deleting}>
                   {deleting ? '正处清理线...' : '证实且不可逆销毁'}
               </Button>
           </DialogActions>
       </Dialog>
    </Box>
  );
}
