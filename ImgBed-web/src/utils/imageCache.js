/**
 * 图片缓存管理工具
 *
 * 功能：
 * 1. 记录已加载的图片 ID 列表
 * 2. 支持增量加载（只请求新图片）
 * 3. 利用浏览器 HTTP 缓存（ETag/Last-Modified）
 */

const CACHE_KEY = 'imgbed_loaded_images';
const CACHE_VERSION = 'v1';

class ImageCacheManager {
  constructor() {
    this.loadedImages = this.loadFromStorage();
  }

  /**
   * 从 localStorage 加载已缓存的图片 ID 列表
   */
  loadFromStorage() {
    try {
      const data = localStorage.getItem(CACHE_KEY);
      if (!data) return new Set();

      const parsed = JSON.parse(data);
      if (parsed.version !== CACHE_VERSION) {
        // 版本不匹配，清空缓存
        localStorage.removeItem(CACHE_KEY);
        return new Set();
      }

      return new Set(parsed.ids || []);
    } catch (error) {
      console.warn('加载图片缓存失败:', error);
      return new Set();
    }
  }

  /**
   * 保存到 localStorage
   */
  saveToStorage() {
    try {
      const data = {
        version: CACHE_VERSION,
        ids: Array.from(this.loadedImages),
        timestamp: Date.now()
      };
      localStorage.setItem(CACHE_KEY, JSON.stringify(data));
    } catch (error) {
      console.warn('保存图片缓存失败:', error);
    }
  }

  /**
   * 标记图片已加载
   */
  markAsLoaded(imageId) {
    if (!imageId) return;
    this.loadedImages.add(imageId);
    this.saveToStorage();
  }

  /**
   * 批量标记图片已加载
   */
  markBatchAsLoaded(imageIds) {
    if (!Array.isArray(imageIds)) return;
    imageIds.forEach(id => this.loadedImages.add(id));
    this.saveToStorage();
  }

  /**
   * 检查图片是否已加载过
   */
  isLoaded(imageId) {
    return this.loadedImages.has(imageId);
  }

  /**
   * 过滤出新图片（未加载过的）
   */
  filterNewImages(images) {
    if (!Array.isArray(images)) return [];
    return images.filter(img => !this.isLoaded(img.id));
  }

  /**
   * 清空缓存
   */
  clear() {
    this.loadedImages.clear();
    localStorage.removeItem(CACHE_KEY);
  }

  /**
   * 获取缓存统计
   */
  getStats() {
    return {
      totalCached: this.loadedImages.size,
      version: CACHE_VERSION
    };
  }
}

// 单例模式
const imageCacheManager = new ImageCacheManager();

export default imageCacheManager;
