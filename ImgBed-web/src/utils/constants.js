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
  sm: 1, // 小元素：缩略图、进度条、列表项
  md: 2, // 中元素：卡片、按钮、对话框
  lg: 3, // 大元素：页面卡片、登录框
};
