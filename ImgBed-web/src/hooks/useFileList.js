import { useState, useCallback, useRef } from 'react';
import { FileDocs } from '../api';

export function useFileList() {
  const [data, setData] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [hasMore, setHasMore] = useState(false);
  const loadingRef = useRef(false);

  const loadFiles = useCallback(async (params, options = {}) => {
    const { append = false, pageSize } = options;

    if (loadingRef.current) return;
    loadingRef.current = true;
    setLoading(true);
    setError(null);

    try {
      const res = await FileDocs.list(params);
      if (res.code === 0 && res.data) {
        const list = res.data.list || [];
        const tot = res.data.pagination?.total || 0;

        setData(prev => append ? [...prev, ...list] : list);
        setTotal(tot);

        if (pageSize) {
          const loaded = append ? (params.page - 1) * pageSize + list.length : list.length;
          setHasMore(loaded < tot);
        }

        return { list, total: tot };
      }
    } catch (err) {
      setError('获取文件列表失败');
      console.error(err);
    } finally {
      setLoading(false);
      loadingRef.current = false;
    }
  }, []);

  const reset = useCallback(() => {
    setData([]);
    setTotal(0);
    setHasMore(false);
  }, []);

  return { data, total, loading, error, hasMore, loadFiles, reset };
}
