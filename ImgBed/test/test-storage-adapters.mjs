/**
 * 存储适配器测试套件
 * 测试 Telegram 和 S3 的 delete() 方法修复
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';

describe('存储适配器 - Telegram delete()', () => {
  it('应该返回 false 表示不支持删除', async () => {
    const { default: TelegramStorage } = await import('../src/storage/telegram.js');
    const storage = new TelegramStorage({
      botToken: 'test_token',
      chatId: 'test_chat'
    });

    const result = await storage.delete('test_file_id');
    assert.strictEqual(result, false, 'Telegram delete() 应返回 false');
  });

  it('应该捕获异常并返回 false', async () => {
    const { default: TelegramStorage } = await import('../src/storage/telegram.js');
    const storage = new TelegramStorage({
      botToken: 'test_token',
      chatId: 'test_chat'
    });

    // 即使传入异常参数也应该返回 false 而不是抛出异常
    const result = await storage.delete(null);
    assert.strictEqual(result, false, '异常情况下应返回 false');
  });
});

describe('存储适配器 - S3 delete()', () => {
  it('应该捕获删除失败的异常并返回 false', async () => {
    const { default: S3Storage } = await import('../src/storage/s3.js');

    // 创建一个会失败的 S3 实例（无效凭证）
    const storage = new S3Storage({
      bucket: 'test-bucket',
      region: 'us-east-1',
      accessKeyId: 'invalid',
      secretAccessKey: 'invalid'
    });

    // 删除操作应该捕获异常并返回 false
    const result = await storage.delete('test-file-id');
    assert.strictEqual(result, false, 'S3 删除失败应返回 false 而不是抛出异常');
  });
});

describe('存储适配器 - 接口一致性', () => {
  it('所有适配器的 delete() 都应返回 boolean', async () => {
    const adapters = [
      { name: 'Local', module: '../src/storage/local.js', config: { baseDir: './test-uploads' } },
      { name: 'Telegram', module: '../src/storage/telegram.js', config: { botToken: 'test', chatId: 'test' } },
      { name: 'S3', module: '../src/storage/s3.js', config: { bucket: 'test', region: 'us-east-1', accessKeyId: 'test', secretAccessKey: 'test' } },
      { name: 'Discord', module: '../src/storage/discord.js', config: { webhookUrl: 'https://discord.com/api/webhooks/test/test' } },
      { name: 'HuggingFace', module: '../src/storage/huggingface.js', config: { token: 'test', repo: 'test/test' } },
      { name: 'External', module: '../src/storage/external.js', config: { baseUrl: 'https://example.com/' } }
    ];

    for (const adapter of adapters) {
      const { default: StorageClass } = await import(adapter.module);
      const storage = new StorageClass(adapter.config);

      // 调用 delete() 应该返回 boolean 类型
      const result = await storage.delete('test-id');
      assert.strictEqual(typeof result, 'boolean', `${adapter.name} delete() 应返回 boolean`);
    }
  });
});
