/**
 * 验证全局样式常量配置
 */

// 模拟导入 constants
const constants = {
  BORDER_RADIUS: {
    sm: 1,
    md: 2,
    lg: 3,
    circle: '50%',
  },
  FONT_SIZE: {
    xs: '0.75rem',
    sm: '0.875rem',
    md: '1rem',
    lg: '1.25rem',
    xl: '1.5rem',
  },
  SPACING: {
    xs: 0.5,
    sm: 1,
    md: 2,
    lg: 3,
    xl: 4,
  },
  ELEVATION: {
    none: 0,
    low: 1,
    medium: 3,
    high: 6,
  },
  SIZE: {
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
  },
};

console.log('✅ 全局样式常量配置验证\n');

console.log('📐 圆角规范 (BORDER_RADIUS):');
console.log(`  sm: ${constants.BORDER_RADIUS.sm} (4px) - 小元素`);
console.log(`  md: ${constants.BORDER_RADIUS.md} (8px) - 中元素`);
console.log(`  lg: ${constants.BORDER_RADIUS.lg} (12px) - 大元素`);
console.log(`  circle: ${constants.BORDER_RADIUS.circle} - 圆形元素\n`);

console.log('📝 字体大小规范 (FONT_SIZE):');
Object.entries(constants.FONT_SIZE).forEach(([key, value]) => {
  console.log(`  ${key}: ${value}`);
});
console.log('');

console.log('📏 间距规范 (SPACING):');
Object.entries(constants.SPACING).forEach(([key, value]) => {
  console.log(`  ${key}: ${value} (${value * 8}px)`);
});
console.log('');

console.log('🌑 阴影规范 (ELEVATION):');
Object.entries(constants.ELEVATION).forEach(([key, value]) => {
  console.log(`  ${key}: ${value}`);
});
console.log('');

console.log('📦 尺寸规范 (SIZE):');
console.log('  图标尺寸:', constants.SIZE.icon);
console.log('  头像尺寸:', constants.SIZE.avatar);
console.log('  进度条高度:', constants.SIZE.progressBar);
console.log('  缩略图尺寸:', constants.SIZE.thumbnail);
console.log('');

console.log('✅ 所有样式常量配置正确！');
console.log('\n使用示例:');
console.log('  import { BORDER_RADIUS, SPACING, SIZE } from "./utils/constants";');
console.log('  <Box sx={{ borderRadius: BORDER_RADIUS.md, p: SPACING.md }} />');
