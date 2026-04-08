import { Fragment, useState, useEffect } from 'react';
import {
  Box, Card, Typography, Button, Snackbar, Alert, CircularProgress,
  List, Divider, useTheme, Dialog, DialogTitle, DialogContent,
  DialogActions, TextField
} from '@mui/material';
import CloudUploadIcon from '@mui/icons-material/CloudUpload';
import { BORDER_RADIUS } from '../utils/constants';
import HomeFileItem from '../components/home/HomeFileItem';
import { useHomeUpload } from '../hooks/useHomeUpload';
import { PublicAPI } from '../api';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';

export default function HomePage() {
  const theme = useTheme();
  const navigate = useNavigate();
  const { user } = useAuth();
  const {
    entries, uploading, toast, inputRef,
    pendingCount, doneCount,
    passwordDialog, closePasswordDialog,
    handleFileChange, appendFiles, handleRemove, handleClearDone,
    handleCopy, handleUploadAll, closeToast,
  } = useHomeUpload();

  const [passwordInput, setPasswordInput] = useState('');
  const [checkingAuth, setCheckingAuth] = useState(true);

  // 检查访客上传配置
  useEffect(() => {
    const checkGuestUploadConfig = async () => {
      try {
        // 如果用户已登录，跳过检查
        if (user) {
          setCheckingAuth(false);
          return;
        }

        // 检查是否已有访客密码
        const savedPassword = sessionStorage.getItem('uploadPassword');
        if (savedPassword) {
          setCheckingAuth(false);
          return;
        }

        // 获取访客上传配置
        const res = await PublicAPI.getGuestUploadConfig();
        if (res.code === 0 && res.data.requirePassword) {
          // 需要访客密码且未输入，重定向到登录页
          navigate('/login?tab=guest');
          return;
        }

        setCheckingAuth(false);
      } catch (err) {
        console.error('检查访客上传配置失败:', err);
        setCheckingAuth(false);
      }
    };

    checkGuestUploadConfig();
  }, [user, navigate]);

  // 如果正在检查权限，显示加载状态
  if (checkingAuth) {
    return (
      <Box sx={{ flexGrow: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <CircularProgress />
      </Box>
    );
  }

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
            appendFiles(Array.from(e.dataTransfer.files || []));
          }}
          sx={{
            border: '2px dashed',
            borderColor: 'primary.light',
            borderRadius: BORDER_RADIUS.md,
            p: 4,
            textAlign: 'center',
            cursor: uploading ? 'not-allowed' : 'pointer',
            bgcolor: theme.palette.mode === 'dark' ? 'background.paper' : 'grey.50',
            '&:hover': {
              bgcolor: uploading
                ? (theme.palette.mode === 'dark' ? 'background.paper' : 'grey.50')
                : (theme.palette.mode === 'dark' ? 'action.hover' : 'primary.50'),
              borderColor: 'primary.main'
            },
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
                <Fragment key={entry.id}>
                  {idx > 0 && <Divider />}
                  <HomeFileItem
                    entry={entry}
                    uploading={uploading}
                    onCopy={handleCopy}
                    onRemove={handleRemove}
                  />
                </Fragment>
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
        onClose={closeToast}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      >
        <Alert severity={toast.type} onClose={closeToast} sx={{ width: '100%' }}>
          {toast.msg}
        </Alert>
      </Snackbar>

      {/* 上传密码对话框 */}
      <Dialog
        open={passwordDialog.open}
        onClose={() => {
          setPasswordInput('');
          closePasswordDialog();
          passwordDialog.onSubmit?.(null);
        }}
      >
        <DialogTitle>需要上传密码</DialogTitle>
        <DialogContent>
          <Typography variant="body2" color="text.secondary" mb={2}>
            管理员已开启访客上传密码保护，请输入密码后继续上传
          </Typography>
          <TextField
            autoFocus
            fullWidth
            type="password"
            label="上传密码"
            value={passwordInput}
            onChange={(e) => setPasswordInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && passwordInput.trim()) {
                passwordDialog.onSubmit?.(passwordInput.trim());
                setPasswordInput('');
              }
            }}
          />
        </DialogContent>
        <DialogActions>
          <Button
            onClick={() => {
              setPasswordInput('');
              closePasswordDialog();
              passwordDialog.onSubmit?.(null);
            }}
          >
            取消
          </Button>
          <Button
            variant="contained"
            disabled={!passwordInput.trim()}
            onClick={() => {
              passwordDialog.onSubmit?.(passwordInput.trim());
              setPasswordInput('');
            }}
          >
            确认
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
