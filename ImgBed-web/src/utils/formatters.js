/**
 * 格式化日期为本地字符串
 * @param {string} str 日期字符串
 * @returns {string} 格式化后的日期
 */
export function fmtDate(str) {
  if (!str) return '-';
  // SQLite 的 CURRENT_TIMESTAMP 返回 UTC 时间，格式如 "2026-04-18 02:02:30"
  // 如果字符串不包含时区信息（没有 'Z' 或 '+'/'-' 时区偏移），则视为 UTC 时间
  let dateStr = str;
  if (!/Z|[+-]\d{2}:\d{2}$/.test(str)) {
    // 添加 'Z' 后缀表示这是 UTC 时间
    dateStr = str.replace(' ', 'T') + 'Z';
  }
  return new Date(dateStr).toLocaleString('zh-CN', { dateStyle: 'short', timeStyle: 'short' });
}

/**
 * 将后端返回的本地日期字符串 "YYYY-MM-DD" 格式化为 "M/D"。
 * 不使用 new Date()，避免其把无时区日期按 UTC 午夜解析导致跨时区偏移一天。
 * @param {string} str 形如 "2026-04-18" 的本地日期字符串
 * @returns {string}
 */
export function fmtShortDate(str) {
  if (!str) return '-';
  const [, m, d] = str.split('-');
  return `${Number(m)}/${Number(d)}`;
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
 * 解析渠道实例 ID
 * @param {string|null|undefined} storageInstanceId storage_instance_id 字段
 * @returns {string} 渠道 ID 或 '-'
 */
export function parseChannelName(storageInstanceId) {
  return storageInstanceId || '-';
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

/**
 * 解析并归一化标签数据
 * @param {string|string[]|null} tags 标签数据（JSON字符串或数组）
 * @returns {string[]} 标签数组
 */
export function parseTags(tags) {
  if (!tags) return [];
  try {
    const parsed = typeof tags === 'string' ? JSON.parse(tags) : tags;
    if (Array.isArray(parsed)) {
      return parsed.filter(t => t && typeof t === 'string').map(t => t.trim());
    }
    if (typeof parsed === 'string') {
      const split = parsed.split(',').map(t => t.trim()).filter(Boolean);
      return split;
    }
  } catch {
    if (typeof tags === 'string') {
      return tags.split(',').map(t => t.trim()).filter(Boolean);
    }
  }
  return [];
}
