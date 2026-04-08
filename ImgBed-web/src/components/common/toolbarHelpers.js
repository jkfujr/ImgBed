import RefreshIcon from '@mui/icons-material/Refresh';

/**
 * 工具栏配置辅助函数库
 *
 * 提供常用的工具栏配置生成函数，减少重复代码
 */

/**
 * 创建统计信息配置
 *
 * @param {Object} data - 统计数据对象，格式：{ label: { value, color?, bold? } }
 * @returns {Object} GenericToolbar 的 stats 配置
 *
 * @example
 * createStatsConfig({
 *   '共': { value: 10, bold: true },
 *   '已启用': { value: 8, color: 'success.main', bold: true },
 *   '可上传': { value: 5, color: 'primary.main', bold: true }
 * })
 */
export function createStatsConfig(data) {
  return {
    items: Object.entries(data).map(([label, config]) => ({
      label,
      value: config.value,
      color: config.color || 'text.primary',
      bold: config.bold !== false,
    })),
  };
}

/**
 * 创建类型筛选器配置
 *
 * @param {string} value - 当前选中的值
 * @param {Function} onChange - 值变更回调
 * @param {Array<string>} types - 类型列表
 * @param {Object} options - 可选配置
 * @returns {Object} GenericToolbar 的 filter 配置
 *
 * @example
 * createTypeFilterConfig(typeFilter, setTypeFilter, VALID_TYPES)
 */
export function createTypeFilterConfig(value, onChange, types = [], options = {}) {
  return {
    type: 'select',
    label: options.label || '类型筛选',
    value,
    onChange,
    options: [
      { value: 'all', label: options.allLabel || '全部类型' },
      ...types.map(type => ({ value: type, label: type })),
    ],
    minWidth: options.minWidth || 120,
  };
}

/**
 * 创建刷新按钮配置
 *
 * @param {Function} onClick - 点击回调
 * @param {boolean} loading - 是否加载中
 * @param {Object} options - 可选配置
 * @returns {Object} GenericToolbar 的 action 配置
 *
 * @example
 * createRefreshAction(loadStorages, loading)
 */
export function createRefreshAction(onClick, loading = false, options = {}) {
  return {
    type: 'iconButton',
    icon: <RefreshIcon />,
    tooltip: options.tooltip || '刷新列表',
    onClick,
    disabled: loading || options.disabled,
  };
}

/**
 * 创建搜索筛选器配置
 *
 * @param {string} value - 当前搜索值
 * @param {Function} onChange - 值变更回调
 * @param {Object} options - 可选配置
 * @returns {Object} GenericToolbar 的 filter 配置
 *
 * @example
 * createSearchFilterConfig(searchText, setSearchText, { placeholder: '搜索文件名' })
 */
export function createSearchFilterConfig(value, onChange, options = {}) {
  return {
    type: 'text',
    label: options.label,
    placeholder: options.placeholder || '搜索...',
    value,
    onChange,
    minWidth: options.minWidth || 200,
  };
}
