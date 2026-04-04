/**
 * 语法验证测试 - 验证关键路由文件的语法正确性
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const projectRoot = join(__dirname, '..');

describe('语法验证测试', () => {
  it('system.js 应该能够正常加载', async () => {
    try {
      const systemPath = join(projectRoot, 'src', 'routes', 'system.js');
      await import(pathToFileURL(systemPath).href);
      assert.ok(true, 'system.js 加载成功');
    } catch (err) {
      assert.fail(`system.js 加载失败: ${err.message}`);
    }
  });

  it('auth.js 应该能够正常加载', async () => {
    try {
      const authPath = join(projectRoot, 'src', 'routes', 'auth.js');
      await import(pathToFileURL(authPath).href);
      assert.ok(true, 'auth.js 加载成功');
    } catch (err) {
      assert.fail(`auth.js 加载失败: ${err.message}`);
    }
  });

  it('所有新增的服务模块应该能够正常加载', async () => {
    const serviceModules = [
      'services/auth/verify-credentials.js',
      'services/system/create-storage-channel.js',
      'services/system/update-load-balance.js'
    ];

    for (const modulePath of serviceModules) {
      try {
        const fullPath = join(projectRoot, 'src', modulePath);
        await import(pathToFileURL(fullPath).href);
        assert.ok(true, `${modulePath} 加载成功`);
      } catch (err) {
        assert.fail(`${modulePath} 加载失败: ${err.message}`);
      }
    }
  });
});
