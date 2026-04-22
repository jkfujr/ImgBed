/**
 * 存储类型显示颜色映射（MUI Chip 颜色
 */
export const TYPE_COLORS = {
  local: 'default',
  s3: 'primary',
  telegram: 'info',
  discord: 'secondary',
  huggingface: 'warning',
};

/**
 * 各存储类型的配置字段定义
 */
export const CHANNEL_SCHEMAS = {
  local: [
    { key: 'basePath', label: '本地路径', required: true },
  ],
  s3: [
    { key: 'bucket', label: '存储桶名称 (Bucket Name)', required: true, helperText: 'S3 存储桶名称，不含路径。示例：my-bucket' },
    { key: 'region', label: '区域 (Region)', required: true, helperText: 'AWS S3: us-east-1, ap-northeast-1 等 | Cloudflare R2: 填写 "auto" | MinIO: 填写 "auto"' },
    { key: 'accessKeyId', label: '访问密钥 ID (Access Key ID)', required: true, helperText: 'AWS S3: IAM 用户访问密钥 | Cloudflare R2: API 令牌 ID' },
    { key: 'secretAccessKey', label: '访问密钥 (Secret Access Key)', required: true, sensitive: true, helperText: 'AWS S3: IAM 用户密钥 | Cloudflare R2: API 令牌密钥' },
    { key: 'endpoint', label: '端点 (Endpoint)', helperText: 'AWS S3: 留空使用默认 | Cloudflare R2: https://账户ID.r2.cloudflarestorage.com | MinIO: http://localhost:9000（不含 bucket 名称）' },
    { key: 'pathPrefix', label: '路径前缀 (Path Prefix)', helperText: '可选，文件存储的子目录前缀。示例：images/ 或 uploads/2024/' },
    { key: 'publicUrl', label: '公共访问 URL (Public URL)', helperText: '可选，自定义域名或 CDN 地址，用于生成公开访问链接。示例：https://cdn.example.com' },
    { key: 'pathStyle', label: '路径风格 (Path Style)', type: 'boolean', helperText: '启用路径风格访问（bucket 在路径中而非子域名）。MinIO 等需要启用，AWS S3 和 R2 通常不需要' },
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
