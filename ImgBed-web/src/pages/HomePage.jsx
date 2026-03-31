import React, { useState } from 'react';
import { Box, Card, Typography, Button, Snackbar, Alert, CircularProgress, IconButton } from '@mui/material';
import CloudUploadIcon from '@mui/icons-material/CloudUpload';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import api from '../api';

export default function HomePage() {
  const [file, setFile] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [result, setResult] = useState(null);
  const [toast, setToast] = useState({ open: false, msg: '', type: 'info' });

  const handleDisplayToast = (msg, type = 'info') => {
    setToast({ open: true, msg, type });
  };

  const handleFileChange = (e) => {
    if (e.target.files && e.target.files[0]) {
       const selected = e.target.files[0];
       if (!selected.type.startsWith('image/')) {
          handleDisplayToast('抱歉，本站仅支持图片上传', 'error');
          e.target.value = null;
          return;
       }
       setFile(selected);
       setResult(null);
    }
  };

  const handleUpload = async () => {
    if (!file) return;
    setUploading(true);
    try {
      const formData = new FormData();
      formData.append('file', file);
      
      const res = await api.post('/api/upload', formData, {
         headers: { 'Content-Type': 'multipart/form-data' }
      });

      if (res.code === 0) {
         handleDisplayToast('上传成功！', 'success');
         const fullUrl = window.location.origin + res.data.url;
         setResult({ ...res.data, fullUrl });
         setFile(null); // 上传完释放暂存以便继续
      } else {
         handleDisplayToast(res.message || '上传异常', 'error');
      }
    } catch (err) {
      handleDisplayToast(err.response?.data?.message || err.message || '网络连接错误或后端未响应', 'error');
    } finally {
      setUploading(false);
    }
  };

  const handleCopy = (text) => {
     navigator.clipboard.writeText(text);
     handleDisplayToast('以复制到剪贴板！', 'success');
  };

  return (
    <Box sx={{ flexGrow: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', p: 3 }}>
        <Card sx={{ maxWidth: 600, width: '100%', p: 4, textAlign: 'center', boxShadow: 3, borderRadius: 3 }}>
           <Typography variant="h4" fontWeight="bold" gutterBottom color="primary">
               极速图片托管
           </Typography>
           <Typography variant="body1" color="text.secondary" sx={{ mb: 4 }}>
               点击下方按钮或轻松拖拽来上传精彩一刻。
           </Typography>

           {/* 简易拖拽/上传区模拟 */}
           <Box 
             sx={{ 
                border: '2px dashed', 
                borderColor: 'divider', 
                bgcolor: 'action.hover', 
                borderRadius: 2, 
                p: 6,
                mb: 3,
                cursor: 'pointer',
                transition: 'all 0.3s ease',
                '&:hover': {
                    borderColor: 'primary.main',
                    bgcolor: 'primary.50'
                }
             }}
             // TODO: 添加实际的 drag & drop 拦截
             onClick={() => document.getElementById('file-upload-input').click()}
           >
              <input 
                id="file-upload-input" 
                type="file" 
                hidden 
                accept="image/*"
                onChange={handleFileChange} 
              />
              <CloudUploadIcon sx={{ fontSize: 60, color: file ? 'primary.main' : 'text.disabled', mb: 1 }} />
              
              <Typography variant="h6" color={file ? 'primary' : 'textSecondary'}>
                  {file ? file.name : '选择文件或拖曳至此'}
              </Typography>
              {file && (
                 <Typography variant="caption" display="block">
                    {(file.size / 1024 / 1024).toFixed(2)} MB
                 </Typography>
              )}
           </Box>

           <Button 
               variant="contained" 
               color="primary" 
               size="large" 
               disabled={!file || uploading} 
               onClick={handleUpload}
               startIcon={uploading ? <CircularProgress size={20} color="inherit" /> : <CloudUploadIcon />}
               fullWidth
               sx={{ py: 1.5, fontSize: '1.1rem', borderRadius: 2 }}
           >
               {uploading ? '正在努力上传...' : '立即开始上传'}
           </Button>

           {/* 返回结果面板 */}
           {result && (
              <Box sx={{ mt: 4, p: 3, bgcolor: 'success.50', borderRadius: 2, textAlign: 'left', border: '1px solid', borderColor: 'success.200' }}>
                 <Typography variant="subtitle1" fontWeight="bold" color="success.800" gutterBottom>
                     成功入库！
                 </Typography>
                 <Box sx={{ display: 'flex', alignItems: 'center', bgcolor: 'background.paper', p: 1, borderRadius: 1, my: 1 }}>
                     <Typography variant="body2" sx={{ flexGrow: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                         {result.fullUrl}
                     </Typography>
                     <IconButton size="small" onClick={() => handleCopy(result.fullUrl)}>
                         <ContentCopyIcon fontSize="small"/>
                     </IconButton>
                 </Box>
                 {result.fullUrl.match(/\.(jpg|jpeg|png|webp|gif|svg|bmp|ico)/i) && (
                     <Box sx={{ mt: 2, textAlign: 'center' }}>
                         <img src={result.fullUrl} alt="preview" style={{ maxWidth: '100%', maxHeight: 200, borderRadius: 8, boxShadow: '0 4px 12px rgba(0,0,0,0.1)' }} />
                     </Box>
                 )}
              </Box>
           )}
        </Card>

        <Snackbar open={toast.open} autoHideDuration={4000} onClose={() => setToast({...toast, open: false})} anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}>
             <Alert severity={toast.type} onClose={() => setToast({...toast, open: false})} sx={{ width: '100%' }}>
                  {toast.msg}
             </Alert>
        </Snackbar>
    </Box>
  );
}
