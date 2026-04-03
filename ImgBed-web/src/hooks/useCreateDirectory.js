import { useCallback, useState } from 'react';
import { DirectoryDocs } from '../api';

export function useCreateDirectory() {
  const [status, setStatus] = useState('idle');
  const [error, setError] = useState(null);
  const [createdDirectories, setCreatedDirectories] = useState([]);

  const reset = useCallback(() => {
    setStatus('idle');
    setError(null);
    setCreatedDirectories([]);
  }, []);

  const createDirectory = useCallback(async (folderPath, options = {}) => {
    const {
      parentId: initialParentId,
      currentPath,
      onProgress,
      autoResolveConflict = true
    } = options;

    setStatus('creating');
    setError(null);
    setCreatedDirectories([]);

    try {
      const segments = folderPath.split('/').map(s => s.trim()).filter(Boolean);
      if (segments.length === 0) {
        throw new Error('目录名称不能为空');
      }

      let parentId = initialParentId !== undefined ? initialParentId : null;
      if (currentPath && initialParentId === undefined) {
        const currentDir = await DirectoryDocs.findByPath(currentPath);
        if (!currentDir) {
          throw new Error(`当前路径不存在：${currentPath}`);
        }
        parentId = currentDir.id;
      }

      const created = [];

      for (let i = 0; i < segments.length; i += 1) {
        const segment = segments[i];
        onProgress?.(segment, i, segments.length);

        try {
          const res = await DirectoryDocs.create({
            name: segment,
            parent_id: parentId
          });

          if (res.code === 0 && res.data) {
            parentId = res.data.id;
            created.push({ ...res.data, existed: false });
            continue;
          }

          throw new Error(res.message || '创建目录失败');
        } catch (err) {
          if (autoResolveConflict && err.response?.status === 409) {
            const listRes = await DirectoryDocs.list({ type: 'flat' });
            if (listRes.code === 0) {
              const dirs = listRes.data.list || listRes.data || [];
              const existing = dirs.find(d => d.name === segment && d.parent_id === parentId);
              if (existing) {
                parentId = existing.id;
                created.push({ ...existing, existed: true });
                continue;
              }
            }
          }

          throw err;
        }
      }

      setCreatedDirectories(created);
      setStatus('success');
      return { success: true, directories: created };
    } catch (err) {
      const message = err.response?.data?.message || err.message || '创建目录失败';
      setError(message);
      setStatus('error');
      return { success: false, error: message };
    }
  }, []);

  return {
    createDirectory,
    status,
    error,
    createdDirectories,
    reset
  };
}
