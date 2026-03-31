import React, { useState, useRef } from 'react';
import {
  Box, Card, Typography, Button, Snackbar, Alert, CircularProgress,
  IconButton, LinearProgress, Chip, Tooltip, List, ListItem, Divider
} from '@mui/material';
import CloudUploadIcon from '@mui/icons-material/CloudUpload';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import ErrorIcon from '@mui/icons-material/Error';
import api from '../api';

// 单个文件的状态：idle | uploading | done | error
const createFileEntry = (file) => ({
  id: Math.random().toString(36).slice(2),
  file,
  status: 'idle',   // idle | uploading | done | error
  result: null,     // 成功时的响应数据
  errorMsg: null,
});

export default function HomePage() {
  const [entries, setEntries] = useState([]);
  const [uploading, setUploading] = useState(false);
  const [toast, setToast] = useState({ open: false, msg: '', type: 'info' });
  const inputRef = useRef(null);

  const showToast = (msg, type = 'info') => setToast({ open: true, msg, type });

  // 更新某个 entry 的部分字段
  const patchEntry = (id, patch) =>
    setEntries((prev) => prev.map((e) => (e.id === id ? { ...e, ...patch } : e)));

  const handleFileChange = (e) => {
    const files = Array.from(e.target.files || []);
    const valid = files.filter((f) => {
      if (!f.type.startsWith('image/')) {
        showToast(`「${f.name}」不是图片，已跳过`, 'warning');
        return false;
      }
      return true;
    });
    if (valid.length > 0) {
      setEntries((prev) => [...prev, ...valid.map(createFileEntry)]);
    }
    // 清空 input，允许重复选择同一文件
    e.target.value = null;
  };

  const handleRemove = (id) => {
    setEntries((prev) => prev.filter((e) => e.id !== id));
  };

  const handleClearDone = () => {
    setEntries((prev) => prev.filter((e) => e.status !== 'done'));
  };

  const handleCopy = (text) => {
    navigator.clipboard.writeText(text);
    showToast('已复制到剪贴板', 'success');
  };

  // 上传单个 entry
  const uploadOne = async (entry) => {
    patchEntry(entry.id, { status: 'uploading' });
    try {
      const formData = new FormData();
      formData.append('file', entry.file);
      const res = await api.post('/api/upload', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      if (res.code === 0) {
        const fullUrl = window.location.origin + res.data.url;
        patchEntry(entry.id, { status: 'done', result: { ...res.data, fullUrl } });
      } else {
        patchEntry(entry.id, { status: 'error', errorMsg: res.message || '上传失败' });
      }
    } catch (err) {
      patchEntry(entry.id, {
        status: 'error',
        errorMsg: err.response?.data?.message || err.message || '网络错误',
      });
    }
  };

  const handleUploadAll = async () => {
    const pending = entries.filter((e) => e.status === 'idle' || e.status === 'error');
    if (pending.length === 0) return;
    setUploading(true);
    // 逐个串行上传，避免并发过多
    for (const entry of pending) {
      await uploadOne(entry);
    }
    setUploading(false);
    showToast('全部上传完成', 'success');
  };

  const pendingCount = entries.filter((e) => e.status === 'idle' || e.status === 'error').length;
  const doneCount = entries.filter((e) => e.status === 'done').length;

  return (
    <Box sx={{ flexGrow: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', p: 3 }}>
      <Card sx={{ maxWidth: 640, width: '100%', p: 4, boxShadow: 3, borderRadius: 3 }}>
        <Typography variant="h5" fontWeight="bold" textAlign="center" mb={1}>
          图片上传
        </Typography>
        <Typography variant="body2" color="text.secondary" textAlign="center" mb={3}>
          支持 JPG、PNG、GIF、WebP 等常见图片格式，可多选批量上传
        </Typography>
        {/* 拖拽 / 点击上传区 */}
        <Box
          onClick={() => !uploading && inputRef.current?.click()}
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            if (uploading) return;
            const files = Array.from(e.dataTransfer.files || []);
            const valid = files.filter((f) => {
              if (!f.type.startsWith('image/')) {
                showToast(`「${f.name}」不是图片，已跳过`, 'warning');
                return false;
              }
              return true;
            });
            if (valid.length > 0) setEntries((prev) => [...prev, ...valid.map(createFileEntry)]);
          }}
          sx={{
            border: '2px dashed',
            borderColor: 'primary.light',
            borderRadius: 2,
            p: 4,
            textAlign: 'center',
            cursor: uploading ? 'not-allowed' : 'pointer',
            bgcolor: 'grey.50',
            '&:hover': { bgcolor: uploading ? 'grey.50' : 'primary.50', borderColor: 'primary.main' },
            transition: 'background 0.2s',
          }}
        >
          <CloudUploadIcon sx={{ fontSize: 48, color: 'primary.light', mb: 1 }} />
          <Typography variant="body1" color="text.secondary">
            点击选择图片，或将图片拖放至此处
          </Typography>
          <Typography variant="caption" color="text.disabled">
            支持多选
          </Typography>
        </Box>
        <input
          ref={inputRef}
          type="file"
          accept="image/*"
          multiple
          style={{ display: 'none' }}
          onChange={handleFileChange}
        />

        {/* 文件列表 */}
        {entries.length > 0 && (
          <Box mt={2}>
            <Box display="flex" alignItems="center" justifyContent="space-between" mb={1}>
              <Typography variant="body2" color="text.secondary">
                共 {entries.length} 个文件
                {doneCount > 0 && `，已完成 ${doneCount} 个`}
              </Typography>
              {doneCount > 0 && (
                <Button size="small" color="inherit" onClick={handleClearDone}>
                  清除已完成
                </Button>
              )}
            </Box>
            <List disablePadding sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 1, overflow: 'hidden' }}>
              {entries.map((entry, idx) => (
                <React.Fragment key={entry.id}>
                  {idx > 0 && <Divider />}
                  <ListItem
                    disablePadding
                    sx={{ px: 1.5, py: 1, display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}
                  >
                    {/* 缩略图 */}
                    <Box
                      component="img"
                      src={URL.createObjectURL(entry.file)}
                      alt={entry.file.name}
                      sx={{ width: 48, height: 48, objectFit: 'cover', borderRadius: 1, flexShrink: 0 }}
                    />
                    {/* 文件名 + 状态 */}
                    <Box sx={{ flexGrow: 1, minWidth: 0 }}>
                      <Typography variant="body2" noWrap title={entry.file.name}>
                        {entry.file.name}
                      </Typography>
                      {entry.status === 'uploading' && <LinearProgress sx={{ mt: 0.5, height: 3, borderRadius: 1 }} />}
                      {entry.status === 'error' && (
                        <Typography variant="caption" color="error">{entry.errorMsg}</Typography>
                      )}
                      {entry.status === 'done' && entry.result && (
                        <Box display="flex" alignItems="center" gap={0.5} mt={0.5}>
                          <Typography variant="caption" color="text.secondary" noWrap sx={{ maxWidth: 240 }}>
                            {entry.result.fullUrl}
                          </Typography>
                          <Tooltip title="复制链接">
                            <IconButton size="small" onClick={() => handleCopy(entry.result.fullUrl)}>
                              <ContentCopyIcon sx={{ fontSize: 14 }} />
                            </IconButton>
                          </Tooltip>
                        </Box>
                      )}
                    </Box>
                    {/* 状态图标 */}
                    {entry.status === 'done' && <CheckCircleIcon color="success" fontSize="small" />}
                    {entry.status === 'error' && <ErrorIcon color="error" fontSize="small" />}
                    {/* 移除按钮 */}
                    {entry.status !== 'uploading' && (
                      <Tooltip title="移除">
                        <IconButton size="small" onClick={() => handleRemove(entry.id)} disabled={uploading && entry.status === 'uploading'}>
                          <DeleteOutlineIcon fontSize="small" />
                        </IconButton>
                      </Tooltip>
                    )}
                  </ListItem>
                </React.Fragment>
              ))}
            </List>
          </Box>
        )}

        {/* 操作按钮 */}
        <Box mt={3} display="flex" gap={2} justifyContent="center">
          <Button
            variant="outlined"
            onClick={() => !uploading && inputRef.current?.click()}
            disabled={uploading}
          >
            继续添加
          </Button>
          <Button
            variant="contained"
            onClick={handleUploadAll}
            disabled={uploading || pendingCount === 0}
            startIcon={uploading ? <CircularProgress size={16} color="inherit" /> : <CloudUploadIcon />}
          >
            {uploading ? '上传中…' : `上传${pendingCount > 0 ? `（${pendingCount}）` : ''}`}
          </Button>
        </Box>
      </Card>

      <Snackbar
        open={toast.open}
        autoHideDuration={4000}
        onClose={() => setToast({ ...toast, open: false })}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      >
        <Alert severity={toast.type} onClose={() => setToast({ ...toast, open: false })} sx={{ width: '100%' }}>
          {toast.msg}
        </Alert>
      </Snackbar>
    </Box>
  );
}
