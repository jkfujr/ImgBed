import assert from 'node:assert/strict';
import test from 'node:test';

import DiscordStorage from '../../src/storage/discord.js';
import S3Storage from '../../src/storage/s3.js';
import {
  selectTelegramSendMethod,
  shouldFallbackToTelegramDocument,
} from '../../src/storage/telegram.js';

function createDiscordResponse(status, body, retryAfterSeconds = null) {
  return {
    status,
    ok: status >= 200 && status < 300,
    statusText: `HTTP ${status}`,
    headers: {
      get(name) {
        if (name?.toLowerCase() === 'retry-after' && retryAfterSeconds !== null) {
          return String(retryAfterSeconds);
        }

        return null;
      },
    },
    async json() {
      return body;
    },
  };
}

test('Discord 读取消息在 429 下遵守总等待预算并返回失败', async () => {
  const waitCalls = [];
  const discord = new DiscordStorage({
    botToken: 'token',
    channelId: 'channel-1',
    __retryWaitForTest: async (delayMs) => {
      waitCalls.push(delayMs);
    },
  });

  let requestCount = 0;
  discord.requestDiscord = async () => {
    requestCount += 1;
    return createDiscordResponse(429, { message: 'Too Many Requests' }, 5);
  };

  const message = await discord.getMessage('channel-1', 'message-1');

  assert.equal(message, null);
  assert.equal(requestCount, 2);
  assert.deepEqual(waitCalls, [5000]);
});

test('S3 读取对象遇到 Checksum mismatch 时只做一次定向重试', async () => {
  class FakeGetObjectCommand {
    constructor(input) {
      this.input = input;
    }
  }

  S3Storage.__setCommandsForTest({ GetObjectCommand: FakeGetObjectCommand });

  const s3 = new S3Storage({
    bucket: 'bucket-1',
    accessKeyId: 'key',
    secretAccessKey: 'secret',
  });

  const sentInputs = [];
  s3.s3 = {
    async send(command) {
      sentInputs.push(command.input);
      if (sentInputs.length === 1) {
        throw new Error('Checksum mismatch');
      }

      return {
        Body: 'stream',
        ContentLength: 1,
        $metadata: { httpStatusCode: 200 },
      };
    },
  };

  const result = await s3.sendGetObject({
    Bucket: 'bucket-1',
    Key: 'file-1',
  });

  assert.equal(result.ContentLength, 1);
  assert.equal(sentInputs.length, 2);
  assert.equal(sentInputs[0].ChecksumMode, undefined);
  assert.equal(sentInputs[1].ChecksumMode, 'ENABLED');
});

test('Telegram 降级判断只在已定义的 400 场景下触发', () => {
  assert.equal(shouldFallbackToTelegramDocument({
    status: 400,
    telegramDescription: 'PHOTO_INVALID_DIMENSIONS',
  }, 'sendPhoto'), true);

  assert.equal(shouldFallbackToTelegramDocument({
    statusCode: 400,
    telegramDescription: 'some other error',
  }, 'sendPhoto'), false);

  assert.equal(shouldFallbackToTelegramDocument({
    status: 400,
    telegramDescription: 'PHOTO_INVALID_DIMENSIONS',
  }, 'sendDocument'), false);
});

test('Telegram 发送策略按文件类型选择本地方法', () => {
  assert.deepEqual(selectTelegramSendMethod('image/webp', 'demo.webp'), {
    method: 'sendAnimation',
    paramName: 'animation',
  });

  assert.deepEqual(selectTelegramSendMethod('image/svg+xml', 'demo.svg'), {
    method: 'sendDocument',
    paramName: 'document',
  });

  assert.deepEqual(selectTelegramSendMethod('image/png', 'demo.png'), {
    method: 'sendPhoto',
    paramName: 'photo',
  });
});
