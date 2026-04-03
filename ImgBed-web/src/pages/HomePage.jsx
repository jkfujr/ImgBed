import React, { useState, useRef, useEffect } from 'react';
import {
  Box, Card, Typography, Button, Snackbar, Alert, CircularProgress,
  List, Divider
} from '@mui/material';
import CloudUploadIcon from '@mui/icons-material/CloudUpload';
import { ALLOWED_IMAGE_EXTENSIONS, BORDER_RADIUS } from '../utils/constants';
import { useUpload } from '../hooks/useUpload';
import HomeFileItem from '../components/home/HomeFileItem';

// 单个文件的状态：idle | uploading | done | error
const createFileEntry = (file) => ({
  id: Math.random().toString(36).slice(2),
  file,
  previewUrl: URL.createObjectURL(file),
  status: 'idle',   // idle | uploading | done | error
  result: null,     // 成功时的响应数据
  errorMsg: null,
});

export default function HomePage() {
  const [entries, setEntries] = useState([]);
  const [uploading, setUploading] = useState(false);
  const { upload } = useUpload({ refreshMode: 'none' });
  const [toast, setToast] = useState({ open: false, msg: '', type: 'info' });
  const inputRef = useRef(null);
  const entriesRef = useRef([]);

  useEffect(() => {
    entriesRef.current = entries;
  }, [entries]);

  useEffect(() => () => {
    entriesRef.current.forEach((entry) => {
      if (entry.previewUrl) {
        URL.revokeObjectURL(entry.previewUrl);
      }
    });
  }, []);

  const showToast = (msg, type = 'info') => setToast({ open: true, msg, type });

  // 更新某个 entry 的部分字段
  const patchEntry = (id, patch) =>
    setEntries((prev) => prev.map((e) => (e.id === id ? { ...e, ...patch } : e)));

  const revokeEntryPreview = (entry) => {
    if (entry?.previewUrl) {
      URL.revokeObjectURL(entry.previewUrl);
    }
  };

  // 检查文件扩展名是否在允许列表中
  const isAllowedImage = (fileName) => {
    const lower = fileName.toLowerCase();
    return ALLOWED_IMAGE_EXTENSIONS.some((ext) => lower.endsWith(ext));
  };

  const handleFileChange = (e) => {
    appendFiles(Array.from(e.target.files || []));
    // 清空 input，允许重复选择同一文件
    e.target.value = null;
  };

  const collectValidImages = (files) => {
    const valid = [];
    files.forEach((f) => {
      const isImageType = f.type.startsWith('image/');
      const isAllowedExt = isAllowedImage(f.name);
      if (!isImageType && !isAllowedExt) {
        showToast(`「${f.name}」不是图片，已跳过`, 'warning');
        return;
      }
      valid.push(f);
    });
    return valid;
  };

  const appendFiles = (files) => {
    const valid = collectValidImages(files);
    if (valid.length > 0) {
      setEntries((prev) => [...prev, ...valid.map(createFileEntry)]);
    }
  };

  const handleRemove = (id) => {
    setEntries((prev) => {
      const target = prev.find((e) => e.id === id);
      revokeEntryPreview(target);
      return prev.filter((e) => e.id !== id);
    });
  };

  const handleClearDone = () => {
    setEntries((prev) => {
      prev.filter((e) => e.status === 'done').forEach(revokeEntryPreview);
      return prev.filter((e) => e.status !== 'done');
    });
  };

  const handleCopy = (text) => {
    navigator.clipboard.writeText(text);
    showToast('已复制到剪贴板', 'success');
  };

  // 上传单个 entry
  const uploadOne = async (entry) => {
    patchEntry(entry.id, { status: 'uploading' });
    try {
      const result = await upload(entry.file);
      if (result.success) {
        const fullUrl = window.location.origin + result.data.url;
        patchEntry(entry.id, { status: 'done', result: { ...result.data, fullUrl } });
      } else {
        patchEntry(entry.id, { status: 'error', errorMsg: result.error });
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
      <Card sx={{ maxWidth: 640, width: '100%', p: 4, boxShadow: 3, borderRadius: BORDER_RADIUS.lg }}>
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
            appendFiles(files);
          }}
          sx={{
            border: '2px dashed',
            borderColor: 'primary.light',
            borderRadius: BORDER_RADIUS.md,
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
            <List disablePadding sx={{ border: '1px solid', borderColor: 'divider', borderRadius: BORDER_RADIUS.sm, overflow: 'hidden' }}>
              {entries.map((entry, idx) => (
                <React.Fragment key={entry.id}>
                  {idx > 0 && <Divider />}
                  <HomeFileItem
                    entry={entry}
                    uploading={uploading}
                    onCopy={handleCopy}
                    onRemove={handleRemove}
                  />
                </React.Fragment>
              ))}
            </List>
          </Box>
        )}

        {/* 操作按钮 */}
        <Box mt={3} display="flex" gap={2} justifyContent="center">
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
