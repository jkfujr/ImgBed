import { useEffect, useRef, useState } from 'react';
import { Box, Breadcrumbs, Link, Typography } from '@mui/material';
import NavigateNextIcon from '@mui/icons-material/NavigateNext';
import { BORDER_RADIUS } from '../../utils/constants';
import { normalizeDirectoryPath, ROOT_DIR } from '../../admin/filesAdminShared';

/**
 * 可编辑面包屑路径编辑器
 *
 * 功能：
 * - 展示模式下显示分段面包屑导航
 * - 点击路径区域进入编辑模式
 * - 支持 Enter/Blur 提交、Escape 取消
 * - 自动规范化路径（前缀 /，空值转为 /）
 *
 * @param {string} currentDir - 当前路径，如 "/folder1/folder2"
 * @param {(path: string) => void} onNavigate - 导航回调
 * @param {string} [rootLabel='根目录'] - 根目录标签
 */
export default function BreadcrumbPathEditor({
  currentDir,
  onNavigate,
  rootLabel = '根目录',
}) {
  const [pathEditing, setPathEditing] = useState(false);
  const pathInputRef = useRef(null);

  useEffect(() => {
    if (!pathEditing) return undefined;
    if (pathInputRef.current) {
      pathInputRef.current.value = currentDir;
    }
    const timer = setTimeout(() => pathInputRef.current?.focus(), 0);
    return () => clearTimeout(timer);
  }, [pathEditing, currentDir]);

  const commitPathEdit = () => {
    const raw = pathInputRef.current?.value || '';
    onNavigate(normalizeDirectoryPath(raw));
    setPathEditing(false);
  };

  const cancelPathEdit = () => {
    setPathEditing(false);
  };

  const segments = currentDir
    ? currentDir.split('/').filter(Boolean)
    : [];

  const segmentHoverSx = {
    cursor: 'pointer',
    fontSize: 14,
    border: 'none',
    background: 'none',
    p: 0,
    borderRadius: 1,
    px: 0.5,
    py: 0.25,
    transition: 'background-color 0.15s',
    '&:hover': { bgcolor: 'action.hover' },
  };

  return (
    <>
      {pathEditing ? (
        <Box
          sx={{
            flex: 1,
            minWidth: 0,
            display: 'flex',
            alignItems: 'center',
            px: 1.5,
            borderRadius: BORDER_RADIUS.sm,
            border: '1px solid',
            borderColor: 'primary.main',
            bgcolor: 'background.paper',
            height: '100%',
          }}
        >
          <input
            ref={pathInputRef}
            defaultValue={currentDir}
            onBlur={commitPathEdit}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commitPathEdit();
              if (e.key === 'Escape') cancelPathEdit();
            }}
            autoFocus
            style={{
              flex: 1,
              border: 'none',
              outline: 'none',
              background: 'transparent',
              fontSize: 14,
              fontFamily: 'inherit',
              color: 'inherit',
              padding: '6px 0',
              boxSizing: 'border-box',
              minWidth: 0,
            }}
          />
        </Box>
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
            py: 0,
            borderRadius: BORDER_RADIUS.sm,
            bgcolor: 'background.paper',
            border: '1px solid transparent',
          }}
        >
          <Breadcrumbs
            separator={<NavigateNextIcon fontSize="small" />}
            sx={{ fontSize: 14 }}
          >
            <Link
              component="button"
              underline="hover"
              color={currentDir === ROOT_DIR ? 'text.primary' : 'inherit'}
              onClick={(e) => {
                e.stopPropagation();
                onNavigate(ROOT_DIR);
              }}
              sx={{
                cursor: 'pointer',
                fontWeight: currentDir === ROOT_DIR ? 'bold' : 'normal',
                fontSize: 14,
                border: 'none',
                background: 'none',
                p: 0,
                borderRadius: 1,
                px: 0.5,
                py: 0.25,
                transition: 'background-color 0.15s',
                '&:hover': { bgcolor: 'action.hover' },
              }}
            >
              {rootLabel}
            </Link>
            {segments.map((seg, i) => {
              const path = normalizeDirectoryPath(`${ROOT_DIR}${segments.slice(0, i + 1).join('/')}`);
              const isLast = i === segments.length - 1;
              return isLast ? (
                <Typography
                  key={path}
                  fontSize={14}
                  fontWeight="bold"
                  color="text.primary"
                  noWrap
                  sx={{
                    borderRadius: 1,
                    px: 0.5,
                    py: 0.25,
                    transition: 'background-color 0.15s',
                    '&:hover': { bgcolor: 'action.hover' },
                  }}
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
                  sx={segmentHoverSx}
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
