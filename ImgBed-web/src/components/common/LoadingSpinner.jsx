import { Box, CircularProgress } from '@mui/material';

/**
 * 统一的加载转圈组件
 * @param {Object} props
 * @param {boolean} props.fullHeight - 是否填充整个父容器高度（默认 true）
 * @param {number} props.size - 转圈大小（默认 40）
 * @param {string} props.color - 转圈颜色（默认 'primary'）
 */
export default function LoadingSpinner({ fullHeight = true, size = 40, color = 'primary' }) {
  return (
    <Box
      sx={{
        height: fullHeight ? '100%' : 'auto',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        py: fullHeight ? 0 : 6,
      }}
    >
      <CircularProgress size={size} color={color} />
    </Box>
  );
}
