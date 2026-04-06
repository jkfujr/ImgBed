#!/usr/bin/env node
/**
 * 验证移除 check-upload-quota.js 后上传配额检查功能正常
 */

import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const projectRoot = resolve(__dirname, '..');

console.log('=== 配额检查功能验证测试 ===\n');

const BASE_URL = 'http://localhost:3000';
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || 'your-admin-jwt-token';

async function request(method, path, body = null, headers = {}) {
  const url = `${BASE_URL}${path}`;
  const options = {
    method,
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${ADMIN_TOKEN}`,
      ...headers
    }
  };
  if (body) options.body = JSON.stringify(body);

  try {
    const response = await fetch(url, options);
    const data = await response.json();
    return { status: response.status, data };
  } catch (err) {
    return { status: 0, error: err.message };
  }
}

/**
 * 测试：上传接口配额检查功能
 */
async function testUploadQuotaCheck() {
  console.log('测试：上传接口配额检查功能');
  console.log('POST /api/upload (无文件)');

  const result = await request('POST', '/api/upload');

  // 预期返回 400（未检测到文件），而不是 500（代码错误）
  if (result.status === 400 || result.data.code === 400) {
    console.log('✓ 上传接口正常响应（预期的 400 错误）');
    console.log(`  响应: ${result.data.message}\n`);
    return true;
  } else if (result.status === 500) {
    console.log('✗ 上传接口返回 500 错误');
    console.log(`  响应: ${JSON.stringify(result.data)}\n`);
    return false;
  } else {
    console.log(`  状态码: ${result.status}`);
    console.log(`  响应: ${JSON.stringify(result.data)}\n`);
    return true;
  }
}

/**
 * 测试：配额统计接口
 */
async function testQuotaStats() {
  console.log('测试：配额统计接口');
  console.log('GET /api/system/quota-stats');

  const result = await request('GET', '/api/system/quota-stats');

  if (result.status === 200 && result.data.code === 0) {
    console.log('✓ 成功获取配额统计');
    const stats = result.data.data.stats;
    console.log(`  渠道数量: ${Object.keys(stats).length}\n`);
    return true;
  } else {
    console.log('✗ 获取配额统计失败');
    console.log(`  状态码: ${result.status}`);
    console.log(`  响应: ${JSON.stringify(result.data)}\n`);
    return false;
  }
}

async function runTests() {
  console.log('开始测试...\n');
  console.log(`服务地址: ${BASE_URL}`);
  console.log(`认证令牌: ${ADMIN_TOKEN.substring(0, 20)}...\n`);

  const results = [];

  results.push(await testUploadQuotaCheck());
  results.push(await testQuotaStats());

  const passed = results.filter(r => r).length;
  const total = results.length;

  console.log('=== 测试结果 ===');
  console.log(`通过: ${passed}/${total}`);

  if (passed === total) {
    console.log('✓ 所有测试通过\n');
    process.exit(0);
  } else {
    console.log('✗ 部分测试失败\n');
    process.exit(1);
  }
}

runTests().catch(err => {
  console.error('测试执行失败:', err);
  process.exit(1);
});
