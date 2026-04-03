import { useState, useCallback, useEffect, useRef } from 'react';

/**
 * 图片缩放/拖拽交互 hook
 * 管理图片的 transform 状态（平移、缩放），处理鼠标滚轮缩放和拖拽移动
 */
export default function useImageTransform({ open, item }) {
  const [imgTransform, setImgTransform] = useState({ x: 0, y: 0, scale: 1 });
  const [isDragging, setIsDragging] = useState(false);
  const [isReady, setIsReady] = useState(false);
  const [isImageLoaded, setIsImageLoaded] = useState(false);
  const [shouldAnimate, setShouldAnimate] = useState(false);
  const [showZoomIndicator, setShowZoomIndicator] = useState(false);

  const containerRef = useRef(null);
  const transformMapRef = useRef({}); // 每张图的独立缩放/位移状态
  const itemIdRef = useRef(null);     // 当前图片 id，供回调读取
  const zoomTimerRef = useRef(null);  // 缩放提示定时器
  const dragStartRef = useRef({ x: 0, y: 0 }); // 拖动起点

  // 计算初始自适应缩放
  const calculateInitialScale = useCallback((targetItem, container) => {
    if (!targetItem || !container) return { x: 0, y: 0, scale: 1 };

    const containerWidth = container.clientWidth;
    const containerHeight = container.clientHeight;
    if (containerWidth === 0 || containerHeight === 0) return { x: 0, y: 0, scale: 1 };

    let initialScale = 1;
    const imgW = Number(targetItem.width) || 0;
    const imgH = Number(targetItem.height) || 0;

    if (imgW > 0 && imgH > 0) {
      const containerRatio = containerWidth / containerHeight;
      const imgRatio = imgW / imgH;

      if (imgRatio > containerRatio) {
        initialScale = (containerWidth * 0.9) / imgW;
      } else {
        initialScale = (containerHeight * 0.9) / imgH;
      }
      initialScale = Math.min(Math.max(initialScale, 0.01), 1);
    }
    return { x: 0, y: 0, scale: initialScale };
  }, []);

  // 状态变更同步到 Map
  const updateTransform = useCallback((newStateOrUpdater) => {
    setImgTransform(prev => {
      const next = typeof newStateOrUpdater === 'function' ? newStateOrUpdater(prev) : newStateOrUpdater;
      const currentId = itemIdRef.current;
      if (currentId) {
        transformMapRef.current[currentId] = next;
      }
      return next;
    });
  }, []);

  // 打开或切换图片时计算并应用缩放
  useEffect(() => {
    if (!open || !item) {
      Promise.resolve().then(() => {
        setIsReady(false);
        setIsImageLoaded(false);
        setShouldAnimate(false);
      });
      itemIdRef.current = null;
      return;
    }

    itemIdRef.current = item.id;

    const applyTransform = () => {
      const container = containerRef.current;
      if (!container) return;

      let state = transformMapRef.current[item.id];
      if (!state) {
        state = calculateInitialScale(item, container);
        transformMapRef.current[item.id] = state;
      }

      setImgTransform(state);
      setIsReady(true);
      setShouldAnimate(false);
    };

    requestAnimationFrame(applyTransform);

    const timer = setTimeout(() => {
      applyTransform();
      setShouldAnimate(true);
    }, 150);

    return () => clearTimeout(timer);
  }, [open, item, calculateInitialScale]);

  // 图片加载完成回调
  const handleImageLoad = useCallback(() => {
    setIsImageLoaded(true);
    const currentId = itemIdRef.current;
    const container = containerRef.current;
    if (!container || !currentId) return;

    if (!transformMapRef.current[currentId] || transformMapRef.current[currentId].scale === 1) {
      const state = calculateInitialScale(item, container);
      updateTransform(state);
    }
  }, [item, calculateInitialScale, updateTransform]);

  // 滚轮缩放
  const handleWheel = useCallback((e) => {
    if (!isReady) return;
    e.preventDefault();
    const delta = e.deltaY > 0 ? 0.9 : 1.1;
    updateTransform(prev => ({
      ...prev,
      scale: Math.min(Math.max(prev.scale * delta, 0.01), 50)
    }));

    setShowZoomIndicator(true);
    if (zoomTimerRef.current) clearTimeout(zoomTimerRef.current);
    zoomTimerRef.current = setTimeout(() => {
      setShowZoomIndicator(false);
    }, 1500);
  }, [isReady, updateTransform]);

  // 绑定非被动 Wheel 事件
  useEffect(() => {
    const node = containerRef.current;
    if (open && node) {
      node.addEventListener('wheel', handleWheel, { passive: false });
      return () => node.removeEventListener('wheel', handleWheel);
    }
  }, [open, handleWheel]);

  // 清理定时器
  useEffect(() => {
    return () => {
      if (zoomTimerRef.current) clearTimeout(zoomTimerRef.current);
    };
  }, []);

  // 拖拽开始
  const handleMouseDown = useCallback((e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    setIsDragging(true);
    dragStartRef.current = { x: e.clientX, y: e.clientY };
  }, []);

  // 拖拽移动
  const handleMouseMove = useCallback((e) => {
    if (!isDragging) return;
    const dx = e.clientX - dragStartRef.current.x;
    const dy = e.clientY - dragStartRef.current.y;
    updateTransform(prev => ({
      ...prev,
      x: prev.x + dx,
      y: prev.y + dy
    }));
    dragStartRef.current = { x: e.clientX, y: e.clientY };
  }, [isDragging, updateTransform]);

  // 拖拽结束
  const handleMouseUp = useCallback(() => {
    setIsDragging(false);
  }, []);

  // 全局鼠标事件绑定
  useEffect(() => {
    if (isDragging) {
      window.addEventListener('mousemove', handleMouseMove);
      window.addEventListener('mouseup', handleMouseUp);
    } else {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    }
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isDragging, handleMouseMove, handleMouseUp]);

  return {
    containerRef,
    imgTransform,
    isDragging,
    isReady,
    isImageLoaded,
    shouldAnimate,
    showZoomIndicator,
    handleImageLoad,
    handleMouseDown,
  };
}
