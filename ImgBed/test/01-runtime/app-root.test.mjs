import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';

import { resolveAppPath, resolveAppRoot } from '../../src/config/app-root.js';

test('resolveAppRoot 优先使用 IMGBED_APP_ROOT', () => {
  const root = resolveAppRoot({
    env: {
      IMGBED_APP_ROOT: './sandbox/runtime-root',
    },
    pathImpl: path,
    fileURLToPathImpl: () => path.join('F:\\', 'Code', 'ignored.js'),
  });

  assert.equal(root, path.resolve('./sandbox/runtime-root'));
});

test('resolveAppRoot 默认回退到当前模块的上两级目录', () => {
  const appRoot = resolveAppRoot({
    env: {},
    pathImpl: path,
    fileURLToPathImpl: () => path.join('F:\\', 'Code', 'code', '0x10_fork', 'ImgBed', 'ImgBed', 'src', 'config', 'app-root.js'),
  });

  assert.equal(appRoot, path.resolve('F:\\Code\\code\\0x10_fork\\ImgBed\\ImgBed'));
});

test('resolveAppPath 基于应用根目录解析相对路径', () => {
  const resolvedPath = resolveAppPath('./data/config.json', {
    env: {
      IMGBED_APP_ROOT: 'F:\\Code\\code\\0x10_fork\\ImgBed\\ImgBed',
    },
    pathImpl: path,
    fileURLToPathImpl: () => path.join('F:\\', 'Code', 'ignored.js'),
  });

  assert.equal(
    resolvedPath,
    path.resolve('F:\\Code\\code\\0x10_fork\\ImgBed\\ImgBed', './data/config.json'),
  );
});
