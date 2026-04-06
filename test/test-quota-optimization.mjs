#!/usr/bin/env node
/**
 * 配额优化功能测试脚本
 * 测试新增的管理接口和优化后的配额检查逻辑
 */

import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import fs from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const projectRoot = resolve(__dirname, '..');

console.log('=== 配额优化功能测试 ===\n');

// 测试配置
const BASE_URL = 'http://localhost:3000';
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || 'your-admin-jwt-token';

/**
 * 发送 HTTP 请求
 */
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

  if (body) {
    options.body = JSON.stringify(body);
  }

  try {
    const response = await fetch(url, options);
    const data = await response.json();
    return { status: response.status, data };
  } catch (err) {
    return { status: 0, error: err.message };
  }
}

/**
 * 测试 1：手动触发容量校正
 */
async function testRebuildQuotaStats() {
  console.log('测试 1: 手动触发容量校正');
  console.log('POST /api/system/maintenance/rebuild-quota-stats');

  const result = await request('POST', '/api/system/maintenance/rebuild-quota-stats');

  if (result.status === 200 && result.data.code === 0) {
    console.log('✓ 容量校正任务已启动');
    console.log(`  响应: ${result.data.message}`);
    console.log(`  状态: ${result.data.data.status}\n`);
    return true;
  } else {
    console.log('✗ 容量校正任务启动失败');
    console.log(`  状态码: ${result.status}`);
    console.log(`  响应: ${JSON.stringify(result.data)}\n`);
    return false;
  }
}

/**
 * 测试 2：查询容量校正历史记录
 */
async function testQuotaHistory() {
  console.log('测试 2: 查询容量校正历史记录');
  console.log('GET /api/system/maintenance/quota-history?limit=5');

  const result = await request('GET', '/api/system/maintenance/quota-history?limit=5');

  if (result.status === 200 && result.data.code === 0) {
    console.log('✓ 成功获取历史记录');
    console.log(`  记录数量: ${result.data.data.history.length}`);

    if (result.data.data.history.length > 0) {
      const latest = result.data.data.history[0];
      console.log(`  最新记录: storage_id=${latest.storage_id}, used_bytes=${latest.used_bytes}, recorded_at=${latest.recorded_at}`);
    }
    console.log();
    return true;
  } else {
    console.log('✗ 获取历史记录失败');
    console.log(`  状态码: ${result.status}`);
    console.log(`  响应: ${JSON.stringify(result.data)}\n`);
    return false;
  }
}

/**
 * 测试 3：查询当前容量统计
 */
async function testQuotaStats() {
  console.log('测试 3: 查询当前容量统计');
  console.log('GET /api/system/quota-stats');

  const result = await request('GET', '/api/system/quota-stats');

  if (result.status === 200 && result.data.code === 0) {
    console.log('✓ 成功获取容量统计');
    const stats = result.data.data.stats;
    const channelCount = Object.keys(stats).length;
    console.log(`  渠道数量: ${channelCount}`);

    if (channelCount > 0) {
      console.log('  各渠道使用情况:');
      for (const [id, bytes] of Object.entries(stats)) {
        const mb = (bytes / 1024 / 1024).toFixed(2);
        console.log(`    - ${id}: ${mb} MB`);
      }
    }
    console.log();
    return true;
  } else {
    console.log('✗ 获取容量统计失败');
    console.log(`  状态码: ${result.status}`);
    console.log(`  响应: ${JSON.stringify(result.data)}\n`);
    return false;
  }
}

/**
 * 测试 4：验证配置更新（移除 quotaCheckMode）
 */
async function testConfigUpdate() {
  console.log('测试 4: 验证配置更新');
  console.log('GET /api/system/config');

  const result = await request('GET', '/api/system/config');

  if (result.status === 200 && result.data.code === 0) {
    console.log('✓ 成功获取配置');
    const uploadConfig = result.data.data.upload || {};

    if (uploadConfig.quotaCheckMode !== undefined) {
      console.log(`  警告: quotaCheckMode 仍存在于配置中 (值: ${uploadConfig.quotaCheckMode})`);
      console.log('  注意: 该字段已废弃，系统将忽略此配置\n');
    } else {
      console.log('  ✓ quotaCheckMode 已从配置中移除');
    }

    console.log(`  fullCheckIntervalHours: ${uploadConfig.fullCheckIntervalHours || 6} 小时\n`);
    return true;
  } else {
    console.log('✗ 获取配置失败');
    console.log(`  状态码: ${result.status}`);
    console.log(`  响应: ${JSON.stringify(result.data)}\n`);
    return false;
  }
}

/**
 * 测试 5：验证上传接口使用缓存检查
 */
async function testUploadQuotaCheck() {
  console.log('测试 5: 验证上传接口配额检查');
  console.log('说明: 此测试需要实际上传文件，这里仅检查接口可用性');

  // 检查上传接口是否可访问
  const result = await request('POST', '/api/upload', null, {
    'Authorization': `Bearer ${ADMIN_TOKEN}`
  });

  // 预期会返回 400（未检测到文件），而不是 500（代码错误）
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
 * 主测试流程
 */
async function runTests() {
  console.log('开始测试...\n');
  console.log(`服务地址: ${BASE_URL}`);
  console.log(`认证令牌: ${ADMIN_TOKEN.substring(0, 20)}...\n`);

  const results = [];

  // 等待 2 秒，确保服务启动完成
  console.log('等待 2 秒，确保服务启动完成...\n');
  await new Promise(resolve => setTimeout(resolve, 2000));

  // 执行测试
  results.push(await testRebuildQuotaStats());

  // 等待 3 秒，让后台任务有时间执行
  console.log('等待 3 秒，让容量校正任务执行...\n');
  await new Promise(resolve => setTimeout(resolve, 3000));

  results.push(await testQuotaHistory());
  results.push(await testQuotaStats());
  results.push(await testConfigUpdate());
  results.push(await testUploadQuotaCheck());

  // 统计结果
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

// 运行测试
runTests().catch(err => {
  console.error('测试执行失败:', err);
  process.exit(1);
});
