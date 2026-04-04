#!/usr/bin/env node
/**
 * 验证路径配置模块的正确性
 */
import fs from 'node:fs';
import path from 'node:path';
import { PATHS, EXTENSIONS, EXCLUDE_DIRS, ENV_KEYS } from '../shared/config/paths.mjs';

const tests = [];
let passed = 0;
let failed = 0;

function test(name, fn) {
  tests.push({ name, fn });
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

// 测试基础路径存在性
test('PATHS.testRoot 应该存在', () => {
  assert(fs.existsSync(PATHS.testRoot), `testRoot 不存在: ${PATHS.testRoot}`);
});

test('PATHS.workspaceRoot 应该存在', () => {
  assert(fs.existsSync(PATHS.workspaceRoot), `workspaceRoot 不存在: ${PATHS.workspaceRoot}`);
});

test('PATHS.backend.root 应该存在', () => {
  assert(fs.existsSync(PATHS.backend.root), `backend.root 不存在: ${PATHS.backend.root}`);
});

test('PATHS.backend.src 应该存在', () => {
  assert(fs.existsSync(PATHS.backend.src), `backend.src 不存在: ${PATHS.backend.src}`);
});

test('PATHS.frontend.root 应该存在', () => {
  assert(fs.existsSync(PATHS.frontend.root), `frontend.root 不存在: ${PATHS.frontend.root}`);
});

test('PATHS.frontend.src 应该存在', () => {
  assert(fs.existsSync(PATHS.frontend.src), `frontend.src 不存在: ${PATHS.frontend.src}`);
});

test('PATHS.test.backendRules 应该存在', () => {
  assert(fs.existsSync(PATHS.test.backendRules), `test.backendRules 不存在: ${PATHS.test.backendRules}`);
});

test('PATHS.test.shared 应该存在', () => {
  assert(fs.existsSync(PATHS.test.shared), `test.shared 不存在: ${PATHS.test.shared}`);
});

// 测试扩展名配置
test('EXTENSIONS.backend 应该包含 .js', () => {
  assert(EXTENSIONS.backend.includes('.js'), 'backend 扩展名应包含 .js');
});

test('EXTENSIONS.frontend 应该包含 .js 和 .jsx', () => {
  assert(EXTENSIONS.frontend.includes('.js'), 'frontend 扩展名应包含 .js');
  assert(EXTENSIONS.frontend.includes('.jsx'), 'frontend 扩展名应包含 .jsx');
});

// 测试排除目录配置
test('EXCLUDE_DIRS.common 应该包含 node_modules', () => {
  assert(EXCLUDE_DIRS.common.includes('node_modules'), 'common 排除目录应包含 node_modules');
});

test('EXCLUDE_DIRS.backend 应该包含 data', () => {
  assert(EXCLUDE_DIRS.backend.includes('data'), 'backend 排除目录应包含 data');
});

// 测试环境变量键名
test('ENV_KEYS.IMGBED_SRC_ROOT 应该是字符串', () => {
  assert(typeof ENV_KEYS.IMGBED_SRC_ROOT === 'string', 'ENV_KEYS.IMGBED_SRC_ROOT 应该是字符串');
  assert(ENV_KEYS.IMGBED_SRC_ROOT === 'IMGBED_SRC_ROOT', 'ENV_KEYS.IMGBED_SRC_ROOT 值应该正确');
});

// 测试路径是绝对路径
test('所有路径应该是绝对路径', () => {
  assert(path.isAbsolute(PATHS.testRoot), 'testRoot 应该是绝对路径');
  assert(path.isAbsolute(PATHS.workspaceRoot), 'workspaceRoot 应该是绝对路径');
  assert(path.isAbsolute(PATHS.backend.root), 'backend.root 应该是绝对路径');
  assert(path.isAbsolute(PATHS.frontend.root), 'frontend.root 应该是绝对路径');
});

// 运行所有测试
console.log('开始验证路径配置模块...\n');

for (const { name, fn } of tests) {
  try {
    fn();
    console.log(`✓ ${name}`);
    passed++;
  } catch (error) {
    console.error(`✗ ${name}`);
    console.error(`  ${error.message}`);
    failed++;
  }
}

console.log(`\n测试完成: ${passed} 通过, ${failed} 失败`);
process.exit(failed > 0 ? 1 : 0);
