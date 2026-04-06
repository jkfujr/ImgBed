import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

console.log('=== 前端配置修改验证 ===\n');

let passed = true;

try {
  // 1. 验证 UploadConfigPanel.jsx 修改
  console.log('1. 验证 UploadConfigPanel.jsx...');
  const panelPath = path.join(__dirname, '../../ImgBed-web/src/components/admin/UploadConfigPanel.jsx');
  const panelContent = fs.readFileSync(panelPath, 'utf8');

  // 检查是否移除了 Radio 和 RadioGroup
  if (panelContent.includes('RadioGroup') || panelContent.includes('<Radio')) {
    console.log('   ✗ 仍然包含 RadioGroup 或 Radio 组件');
    passed = false;
  } else {
    console.log('   ✓ 已移除 RadioGroup 和 Radio 组件');
  }

  // 检查是否移除了 quotaCheckMode
  if (panelContent.includes('quotaCheckMode')) {
    console.log('   ✗ 仍然包含 quotaCheckMode 引用');
    passed = false;
  } else {
    console.log('   ✓ 已移除 quotaCheckMode 引用');
  }

  // 检查是否添加了 enableFullCheckInterval
  if (panelContent.includes('enableFullCheckInterval')) {
    console.log('   ✓ 已添加 enableFullCheckInterval 开关');
  } else {
    console.log('   ✗ 未找到 enableFullCheckInterval 开关');
    passed = false;
  }

  // 检查是否添加了 S3 并发配置
  if (panelContent.includes('enableS3Concurrent')) {
    console.log('   ✓ 已添加 S3 并发上传配置');
  } else {
    console.log('   ✗ 未找到 S3 并发上传配置');
    passed = false;
  }

  // 检查是否添加了 S3 配置分区
  if (panelContent.includes('S3 渠道') || panelContent.includes('性能优化')) {
    console.log('   ✓ 已添加 S3 配置分区');
  } else {
    console.log('   ✗ 未找到 S3 配置分区');
    passed = false;
  }

  // 2. 验证 useUploadConfig.js 修改
  console.log('\n2. 验证 useUploadConfig.js...');
  const hookPath = path.join(__dirname, '../../ImgBed-web/src/hooks/useUploadConfig.js');
  const hookContent = fs.readFileSync(hookPath, 'utf8');

  // 检查是否移除了 quotaCheckMode
  if (hookContent.includes('quotaCheckMode')) {
    console.log('   ✗ 仍然包含 quotaCheckMode');
    passed = false;
  } else {
    console.log('   ✓ 已移除 quotaCheckMode');
  }

  // 检查是否添加了新字段
  if (hookContent.includes('enableFullCheckInterval')) {
    console.log('   ✓ 已添加 enableFullCheckInterval');
  } else {
    console.log('   ✗ 未找到 enableFullCheckInterval');
    passed = false;
  }

  if (hookContent.includes('enableS3Concurrent')) {
    console.log('   ✓ 已添加 enableS3Concurrent');
  } else {
    console.log('   ✗ 未找到 enableS3Concurrent');
    passed = false;
  }

  // 检查是否读取 performance 配置
  if (hookContent.includes('performance?.s3Multipart')) {
    console.log('   ✓ 已添加 performance 配置读取');
  } else {
    console.log('   ✗ 未找到 performance 配置读取');
    passed = false;
  }

  // 检查是否保存 performance 配置
  if (hookContent.includes('performance: performanceConfig')) {
    console.log('   ✓ 已添加 performance 配置保存');
  } else {
    console.log('   ✗ 未找到 performance 配置保存');
    passed = false;
  }

  // 3. 验证后端配置更新逻辑
  console.log('\n3. 验证后端配置更新逻辑...');
  const systemRoutePath = path.join(__dirname, '../src/routes/system.js');
  const systemRouteContent = fs.readFileSync(systemRoutePath, 'utf8');

  if (systemRouteContent.includes('body.performance')) {
    console.log('   ✓ 已添加 performance 配置处理');
  } else {
    console.log('   ✗ 未找到 performance 配置处理');
    passed = false;
  }

  if (systemRouteContent.includes('cfg.performance.s3Multipart')) {
    console.log('   ✓ 已添加 s3Multipart 配置保存');
  } else {
    console.log('   ✗ 未找到 s3Multipart 配置保存');
    passed = false;
  }

  // 4. 验证配置默认值
  console.log('\n4. 验证配置默认值...');
  const configPath = path.join(__dirname, '../src/config/index.js');
  const configContent = fs.readFileSync(configPath, 'utf8');

  if (configContent.includes('performance:')) {
    console.log('   ✓ 配置文件包含 performance 配置');
  } else {
    console.log('   ✗ 配置文件未包含 performance 配置');
    passed = false;
  }

  if (configContent.includes('s3Multipart:')) {
    console.log('   ✓ 配置文件包含 s3Multipart 配置');
  } else {
    console.log('   ✗ 配置文件未包含 s3Multipart 配置');
    passed = false;
  }

  // 5. 总结修改内容
  console.log('\n=== 修改总结 ===');
  console.log('前端修改：');
  console.log('  - 移除了"自动"和"全量检查"单选框');
  console.log('  - 添加了"定时全量校正"开关');
  console.log('  - 添加了"性能优化"分区');
  console.log('  - 添加了"S3 并发上传"开关');
  console.log('  - 根据后端配置设置默认值');
  console.log('\n后端修改：');
  console.log('  - 支持保存 performance.s3Multipart 配置');
  console.log('  - 支持读取 performance 配置并返回给前端');
  console.log('  - 配置默认值：enabled=true, concurrency=4, maxConcurrency=8');

} catch (err) {
  console.error('\n✗ 验证过程中发生错误:', err);
  passed = false;
}

console.log('\n=== 验证结果 ===');
if (passed) {
  console.log('✓ 所有验证通过');
  process.exit(0);
} else {
  console.log('✗ 部分验证失败');
  process.exit(1);
}
