/**
 * 格式化日期为本地字符串
 * @param {string} str 日期字符串
 * @returns {string} 格式化后的日期
 */
export function fmtDate(str) {
  if (!str) return '-';
  return new Date(str).toLocaleString('zh-CN', { dateStyle: 'short', timeStyle: 'short' });
}

/**
 * 格式化字节大小为人类可读格式
 * @param {number} bytes 字节数
 * @returns {string} 格式化后的大小
 */
export function fmtSize(bytes) {
  if (!bytes && bytes !== 0) return '-';
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  if (bytes < 1024 * 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  return (bytes / (1024 * 1024 * 1024)).toFixed(2) + ' GB';
}

/**
 * 从 storage_config JSON 解析渠道 ID
 * @param {string|object} storageConfig storage_config 字段
 * @returns {string} 渠道 ID 或 '-'
 */
export function parseChannelName(storageConfig) {
  if (!storageConfig) return '-';
  try {
    const cfg = typeof storageConfig === 'string' ? JSON.parse(storageConfig) : storageConfig;
    return cfg.instance_id || '-';
  } catch {
    return '-';
  }
}

/**
 * 获取渠道类型的中文标签
 * @param {string} channel 渠道类型
 * @returns {string} 中文标签
 */
export function channelTypeLabel(channel) {
  const map = {
    local: '本地',
    s3: 'S3',
    telegram: 'Telegram',
    discord: 'Discord',
    huggingface: 'HuggingFace',
    external: '第三方'
  };
  return map[channel] || channel || '-';
}

/**
 * 字节转换为 GB
 * @param {number} bytes 字节数
 * @returns {number} GB 数
 */
export function bytesToGB(bytes) {
  return bytes / (1024 ** 3);
}

/**
 * GB 转换为字节
 * @param {number} gb GB 数
 * @returns {number} 字节数
 */
export function gbToBytes(gb) {
  return gb * (1024 ** 3);
}

/**
 * 计算已用容量百分比
 * @param {number} usedBytes 已用字节
 * @param {number} quotaLimitGB 配额 GB
 * @returns {number} 百分比 0-100
 */
export function calculateQuotaPercent(usedBytes, quotaLimitGB) {
  return Math.min(100, (usedBytes / gbToBytes(quotaLimitGB)) * 100);
}
