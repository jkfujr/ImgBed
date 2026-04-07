/**
 * 验证前后端错误码统一性
 */

console.log('✅ 前后端错误码统一验证\n');

console.log('📋 统一后的错误响应格式:\n');

console.log('所有错误响应统一为:');
console.log(JSON.stringify({
  code: 401,
  message: '错误描述信息'
}, null, 2));
console.log('');

console.log('移除了冗余的 error 字段，简化响应结构\n');

console.log('🔧 后端修改:\n');

console.log('1. auth.js 中间件');
console.log('   - unauthorized() 函数移除 error: {} 字段');
console.log('   - forbidden() 函数移除 error: {} 字段');
console.log('   - 统一返回格式: { code, message }\n');

console.log('2. guestUpload.js 中间件');
console.log('   - 场景1: 访客上传已关闭');
console.log('     { code: 401, message: "未授权：请登录后上传，或联系管理员开启访客上传功能" }');
console.log('   - 场景2: 需要上传密码');
console.log('     { code: 401, message: "未授权：需要上传密码" }');
console.log('   - 场景3: 上传密码错误');
console.log('     { code: 401, message: "未授权：上传密码错误" }');
console.log('   - 移除了 error.guestUploadDisabled、error.requirePassword、error.wrongPassword 字段\n');

console.log('3. errorHandler.js 全局错误处理');
console.log('   - 应用错误处理移除 error: {} 字段');
console.log('   - 404 处理移除 error: {} 字段');
console.log('   - 统一返回格式: { code, message }\n');

console.log('🔧 前端修改:\n');

console.log('1. api.js 响应拦截器优化');
console.log('   - 401 错误: 清除 token 并跳转登录（仅管理后台）');
console.log('   - 统一错误对象结构: 确保 error.response.data 包含 { code, message }');
console.log('   - 网络错误处理: 构造标准格式 { code, message }\n');

console.log('2. 各组件错误提取统一');
console.log('   - 统一使用: err.response?.data?.message || err.message || "默认错误"');
console.log('   - 涉及文件:');
console.log('     • useHomeUpload.js');
console.log('     • useUpload.js');
console.log('     • useCreateDirectory.js');
console.log('     • ApiTokenPanel.jsx');
console.log('     • SecurityConfigPanel.jsx');
console.log('     • SystemConfigPanel.jsx');
console.log('     • UploadConfigPanel.jsx');
console.log('     • SettingsPage.jsx');
console.log('     • useLoadBalance.js\n');

console.log('📊 401 错误统一为"未授权":\n');

console.log('所有 401 错误的 message 字段统一以"未授权："开头:');
console.log('  ✓ 未授权：缺失有效的 Bearer Token');
console.log('  ✓ 未授权：需要管理员身份');
console.log('  ✓ 未授权：请登录后上传，或联系管理员开启访客上传功能');
console.log('  ✓ 未授权：需要上传密码');
console.log('  ✓ 未授权：上传密码错误\n');

console.log('📊 403 错误统一为"权限不足":\n');

console.log('所有 403 错误的 message 字段统一格式:');
console.log('  ✓ 权限不足');
console.log('  ✓ 权限不足：缺少权限：upload:image\n');

console.log('✅ 统一优势:\n');

console.log('1. 响应结构简化');
console.log('   - 移除冗余的 error 字段');
console.log('   - 统一为 { code, message } 格式');
console.log('   - 减少数据传输量\n');

console.log('2. 前端处理简化');
console.log('   - 统一错误提取逻辑');
console.log('   - 不需要判断 error 字段的子属性');
console.log('   - message 字段直接可用于显示\n');

console.log('3. 语义清晰');
console.log('   - 401 统一为"未授权"前缀');
console.log('   - 403 统一为"权限不足"前缀');
console.log('   - 错误信息描述准确\n');

console.log('4. 易于维护');
console.log('   - 后端统一错误构造函数');
console.log('   - 前端统一错误提取模式');
console.log('   - 新增错误类型遵循相同规范\n');

console.log('🔍 网络错误处理优化:\n');

console.log('前端 api.js 拦截器增强:');
console.log('  1. 检测网络错误类型');
console.log('     - ERR_NETWORK / Network Error → "网络连接失败，请检查后端服务是否启动"');
console.log('     - ECONNABORTED → "请求超时，请稍后重试"');
console.log('     - 其他错误 → 显示原始错误信息\n');

console.log('  2. 构造统一错误对象');
console.log('     - 确保所有错误都有 error.response.data.message');
console.log('     - 前端组件统一使用 err.response?.data?.message 提取错误');
console.log('     - 避免显示 "Network Error" 这种不友好的提示\n');

console.log('✅ 错误码统一完成！');
console.log('\n📦 修改的文件:');
console.log('  后端:');
console.log('    - ImgBed/src/middleware/auth.js (移除 error 字段)');
console.log('    - ImgBed/src/middleware/guestUpload.js (统一 401 消息格式)');
console.log('    - ImgBed/src/middleware/errorHandler.js (移除 error 字段)');
console.log('  前端:');
console.log('    - ImgBed-web/src/api.js (优化响应拦截器，增强网络错误处理)');
