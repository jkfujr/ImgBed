/**
 * 分析为什么仅修改 vite.config.js 不够
 *
 * 从日志可以看到:
 * 1. 后端日志显示: statusCode 401, responseTime 1-2ms
 * 2. 前端错误: ERR_CONNECTION_RESET (25秒后才报错)
 *
 * 问题分析:
 */

console.log('问题分析:\n');

console.log('1. 后端行为:');
console.log('   - guestUploadAuth 中间件检测到无Token');
console.log('   - 立即返回 res.status(401).json({...})');
console.log('   - 但此时 multipart/form-data 请求体(1.17MB)还在传输中');
console.log('   - Express 没有消费请求体就发送了响应\n');

console.log('2. Vite 代理层行为:');
console.log('   - 设置了 Connection: keep-alive');
console.log('   - 但检测到后端在请求体未读取完就返回响应');
console.log('   - 这违反了 HTTP 协议规范');
console.log('   - 代理层为了保护连接池,强制关闭连接\n');

console.log('3. 前端行为:');
console.log('   - axios 正在上传 1.17MB 的文件');
console.log('   - 突然收到连接重置');
console.log('   - 无法获取到 401 响应\n');

console.log('结论:');
console.log('✗ 仅修改 vite.config.js 不够');
console.log('✓ 必须修改 guestUpload.js 中间件,先消费请求体再返回401');
console.log('✓ 这样才符合 HTTP 协议规范,代理层不会强制关闭连接\n');

console.log('HTTP 协议规范:');
console.log('- 服务器必须读取完整个请求体(或明确拒绝),才能发送响应');
console.log('- 否则代理/负载均衡器会认为连接状态异常,强制关闭连接');
console.log('- 这是为了防止请求走私攻击(HTTP Request Smuggling)\n');

console.log('为什么直接测试后端(test-401-minimal-fix.js)没问题?');
console.log('- 因为测试脚本发送的请求体很小(几百字节)');
console.log('- 在后端返回401之前,请求体已经全部到达后端缓冲区');
console.log('- 所以没有触发连接重置');
console.log('- 但真实场景上传1.17MB文件,请求体传输需要时间,就会触发问题\n');

console.log('必要的修改:');
console.log('1. ✓ vite.config.js: Connection: keep-alive (已修改)');
console.log('2. ✓ guestUpload.js: 消费请求体后再返回401 (必须修改)');
console.log('3. ? auth.js: 优化 req.auth 复用 (性能优化,非必须)');
console.log('4. ? api.js: 401 响应体兜底处理 (防御性编程,非必须)');
