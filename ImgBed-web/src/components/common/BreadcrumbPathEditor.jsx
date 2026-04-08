import { useEffect, useRef, useState } from 'react';
import { Box, Breadcrumbs, Link, TextField, Typography } from '@mui/material';
import NavigateNextIcon from '@mui/icons-material/NavigateNext';
import { BORDER_RADIUS } from '../../utils/constants';

/**
 * 可编辑面包屑路径编辑器
 *
 * 功能：
 * - 展示模式下显示分段面包屑导航
 * - 点击路径区域进入编辑模式
 * - 支持 Enter/Blur 提交、Escape 取消
 * - 自动规范化路径（前缀 /，空值转为 null）
 *
 * @param {string} currentDir - 当前路径，如 "/folder1/folder2"
 * @param {(path: string|null) => void} onNavigate - 导航回调
 * @param {string} [rootLabel='根目录'] - 根目录标签
 */
export default function BreadcrumbPathEditor({
  currentDir,
  onNavigate,
  rootLabel = '根目录',
}) {
  const [pathEditing, setPathEditing] = useState(false);
  const pathInputRef = useRef(null);

  // 进入编辑模式时：填充当前路径并聚焦
  useEffect(() => {
    if (!pathEditing) return undefined;
    if (pathInputRef.current) {
      pathInputRef.current.value = currentDir || '/';
    }
    const timer = setTimeout(() => pathInputRef.current?.focus(), 0);
    return () => clearTimeout(timer);
  }, [pathEditing, currentDir]);

  // 提交路径编辑
  const commitPathEdit = () => {
    const raw = (pathInputRef.current?.value || '').trim();
    let normalized = null;

    if (raw !== '/' && raw !== '') {
      normalized = raw.startsWith('/') ? raw : `/${raw}`;
    }

    onNavigate(normalized);
    setPathEditing(false);
  };

  // 取消路径编辑
  const cancelPathEdit = () => {
    setPathEditing(false);
  };

  // 从当前路径解析分段
  const segments = currentDir
    ? currentDir.split('/').filter(Boolean)
    : [];

  return (
    <>
      {pathEditing ? (
        <TextField
          inputRef={pathInputRef}
          size="small"
          defaultValue={currentDir || '/'}
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
          onClick={() => setPathEditing(true)}
          sx={{
            flex: 1,
            minWidth: 0,
            cursor: 'text',
            display: 'flex',
            alignItems: 'center',
            px: 1.5,
            py: 1,
            border: 1,
            borderColor: 'divider',
            borderRadius: BORDER_RADIUS.sm,
            bgcolor: 'background.paper',
            transition: 'border-color 0.15s, box-shadow 0.15s',
            '&:hover': {
              borderColor: 'primary.main',
              boxShadow: '0 0 0 1px theme.palette.primary.main',
            },
          }}
        >
          <Breadcrumbs
            separator={<NavigateNextIcon fontSize="small" />}
            sx={{ fontSize: 14 }}
          >
            <Link
              component="button"
              underline="hover"
              color={currentDir ? 'inherit' : 'text.primary'}
              onClick={(e) => {
                e.stopPropagation();
                onNavigate(null);
              }}
              sx={{
                cursor: 'pointer',
                fontWeight: !currentDir ? 'bold' : 'normal',
                fontSize: 14,
                border: 'none',
                background: 'none',
                p: 0,
              }}
            >
              {rootLabel}
            </Link>
            {segments.map((seg, i) => {
              const path = '/' + segments.slice(0, i + 1).join('/');
              const isLast = i === segments.length - 1;
              return isLast ? (
                <Typography
                  key={path}
                  fontSize={14}
                  fontWeight="bold"
                  color="text.primary"
                  noWrap
                >
                  {seg}
                </Typography>
              ) : (
                <Link
                  key={path}
                  component="button"
                  underline="hover"
                  color="inherit"
                  onClick={(e) => {
                    e.stopPropagation();
                    onNavigate(path);
                  }}
                  sx={{
                    cursor: 'pointer',
                    fontSize: 14,
                    border: 'none',
                    background: 'none',
                    p: 0,
                  }}
                >
                  {seg}
                </Link>
              );
            })}
          </Breadcrumbs>
        </Box>
      )}
    </>
  );
}
