/**
 * 存储类型显示颜色映射（MUI Chip 颜色
 */
export const TYPE_COLORS = {
  local: 'default',
  s3: 'primary',
  telegram: 'info',
  discord: 'secondary',
  huggingface: 'warning',
  external: 'success',
};

/**
 * 各存储类型的配置字段定义
 */
export const CHANNEL_SCHEMAS = {
  local: [
    { key: 'basePath', label: '本地路径', required: true },
  ],
  s3: [
    { key: 'bucket',          label: 'Bucket 名称',    required: true },
    { key: 'region',          label: 'Region',          required: true },
    { key: 'accessKeyId',     label: 'Access Key ID',   required: true },
    { key: 'secretAccessKey', label: 'Secret Access Key', required: true, sensitive: true },
    { key: 'endpoint',        label: 'Endpoint（自定义）' },
    { key: 'pathPrefix',      label: '路径前缀' },
    { key: 'publicUrl',       label: '公共访问 URL' },
    { key: 'pathStyle',       label: '路径风格', type: 'boolean' },
  ],
  telegram: [
    { key: 'botToken', label: 'Bot Token', required: true, sensitive: true },
    { key: 'chatId',   label: 'Chat ID',   required: true },
    { key: 'proxyUrl', label: '代理地址' },
  ],
  discord: [
    { key: 'webhookUrl', label: 'Webhook URL', required: true, sensitive: true },
    { key: 'channelId',  label: 'Channel ID' },
  ],
  huggingface: [
    { key: 'repo',       label: '仓库名（user/repo）', required: true },
    { key: 'token',      label: 'API Token',            required: true, sensitive: true },
    { key: 'pathPrefix', label: '路径前缀' },
    { key: 'branch',     label: '分支（默认 main）' },
  ],
  external: [
    { key: 'baseUrl',    label: '基础 URL', required: true },
    { key: 'authHeader', label: '认证 Header', sensitive: true },
  ],
};

/**
 * 合法存储类型列表
 */
export const VALID_TYPES = Object.keys(CHANNEL_SCHEMAS);

/**
 * 允许的图片扩展名（文件上传校验）
 */
export const ALLOWED_IMAGE_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.svg', '.bmp', '.ico'];

/**
 * 分页默认每页大小
 */
export const DEFAULT_PAGE_SIZE = 20;

/**
 * 统一圆角规范（使用 MUI 主题单元，1 = 4px）
 */
export const BORDER_RADIUS = {
  sm: 1,     // 4px - 小元素：缩略图、进度条、列表项、按钮
  md: 2,     // 8px - 中元素：卡片、对话框、图片容器
  lg: 3,     // 12px - 大元素：页面卡片、登录框、选择栏
  circle: '50%', // 圆形：头像、状态指示器、排名徽章
};

/**
 * 统一字体大小规范（使用 MUI Typography variant）
 */
export const FONT_SIZE = {
  xs: '0.75rem',    // 12px - 辅助文字、标签
  sm: '0.875rem',   // 14px - 正文、列表项
  md: '1rem',       // 16px - 标题、按钮
  lg: '1.25rem',    // 20px - 页面标题
  xl: '1.5rem',     // 24px - 大标题
};

/**
 * 统一间距规范（使用 MUI 主题单元，1 = 8px）
 */
export const SPACING = {
  xs: 0.5,  // 4px
  sm: 1,    // 8px
  md: 2,    // 16px
  lg: 3,    // 24px
  xl: 4,    // 32px
};

/**
 * 统一阴影规范（使用 MUI elevation）
 */
export const ELEVATION = {
  none: 0,
  low: 1,
  medium: 3,
  high: 6,
};

/**
 * 统一尺寸规范（像素值）
 */
export const SIZE = {
  icon: {
    xs: 16,
    sm: 20,
    md: 24,
    lg: 32,
  },
  avatar: {
    sm: 32,
    md: 40,
    lg: 48,
  },
  progressBar: {
    thin: 3,
    normal: 6,
    thick: 8,
  },
  thumbnail: {
    sm: 48,
    md: 64,
    lg: 80,
  },
};
