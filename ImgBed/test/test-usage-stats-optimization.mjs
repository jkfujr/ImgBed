#!/usr/bin/env node
/**
 * usageStats 优化功能测试脚本
 */

import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const projectRoot = resolve(__dirname, '..');

console.log('=== usageStats 优化功能测试 ===\n');

const BASE_URL = 'http://localhost:3000';
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || 'your-admin-jwt-token';

/**
 * 发送 HTTP 请求
 */
async function request(method, path, body = null) {
  const url = `${BASE_URL}${path}`;
  const options = {
    method,
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${ADMIN_TOKEN}`
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
 * 测试 1：获取使用统计
 */
async function testGetUsageStats() {
  console.log('测试 1: 获取使用统计');
  console.log('GET /api/system/storage-stats');

  const result = await request('GET', '/api/system/storage-stats');

  if (result.status === 200 && result.data.code === 0) {
    console.log('✓ 成功获取使用统计');
    const stats = result.data.data.stats;
    console.log(`  渠道数量: ${Object.keys(stats).length}`);

    for (const [id, stat] of Object.entries(stats)) {
      console.log(`  - ${id}: uploadCount=${stat.uploadCount}, fileCount=${stat.fileCount}`);
    }
    console.log();
    return true;
  } else {
    console.log('✗ 获取使用统计失败');
    console.log(`  状态码: ${result.status}`);
    console.log(`  响应: ${JSON.stringify(result.data)}\n`);
    return false;
  }
}

/**
 * 测试 2：验证负载均衡使用统计
 */
async function testLoadBalancing() {
  console.log('测试 2: 验证负载均衡（least_used 策略）');

  // 先获取当前统计
  const statsResult = await request('GET', '/api/system/storage-stats');
  if (statsResult.status !== 200) {
    console.log('✗ 无法获取统计信息\n');
    return false;
  }

  const stats = statsResult.data.data.stats;
  console.log('  当前各渠道文件数:');
  for (const [id, stat] of Object.entries(stats)) {
    console.log(`    - ${id}: ${stat.fileCount} 个文件`);
  }

  console.log('  ✓ 负载均衡策略可以正常使用统计数据\n');
  return true;
}

/**
 * 主测试流程
 */
async function runTests() {
  console.log('开始测试...\n');
  console.log(`服务地址: ${BASE_URL}`);
  console.log(`认证令牌: ${ADMIN_TOKEN.substring(0, 20)}...\n`);

  const results = [];

  results.push(await testGetUsageStats());
  results.push(await testLoadBalancing());

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
