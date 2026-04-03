import { Dialog, DialogTitle, DialogContent, DialogActions, Button, CircularProgress, Typography } from '@mui/material';

/**
 * 通用确认对话框
 * @param {object} props
 * @param {boolean} props.open 是否打开
 * @param {string} props.title 标题
 * @param {React.ReactNode} props.children 内容（可以是文字或JSX）
 * @param {function} props.onClose 关闭回调
 * @param {function} props.onConfirm 确认回调
 * @param {boolean} props.confirmLoading 确认按钮是否加载
 * @param {string} props.confirmText 确认按钮文字，默认"确认"
 * @param {string} props.cancelText 取消按钮文字，默认"取消"
 * @param {'error'|'primary'} props.confirmColor 确认按钮颜色，默认"error"（删除场景常用）
 */
export default function ConfirmDialog({
  open,
  title,
  children,
  onClose,
  onConfirm,
  confirmLoading = false,
  confirmText = '确认',
  cancelText = '取消',
  confirmColor = 'error',
}) {
  return (
    <Dialog open={open} onClose={confirmLoading ? () => {} : onClose} maxWidth="xs" fullWidth>
      <DialogTitle>{title}</DialogTitle>
      <DialogContent dividers>
        <Typography component="div">{children}</Typography>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={confirmLoading}>
          {cancelText}
        </Button>
        <Button
          variant="contained"
          color={confirmColor}
          onClick={onConfirm}
          disabled={confirmLoading}
        >
          {confirmLoading ? <CircularProgress size={18} color="inherit" /> : confirmText}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
