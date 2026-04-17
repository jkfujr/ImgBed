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

test('S3 非空检查会用 MaxKeys=1 快速判断 bucket 中是否已有对象', async () => {
  class FakeListObjectsV2Command {
    constructor(input) {
      this.input = input;
    }
  }

  S3Storage.__setCommandsForTest({ ListObjectsV2Command: FakeListObjectsV2Command });

  const s3 = new S3Storage({
    bucket: 'bucket-1',
    accessKeyId: 'key',
    secretAccessKey: 'secret',
  });

  const sentInputs = [];
  s3.s3 = {
    async send(command) {
      sentInputs.push(command.input);
      return {
        KeyCount: 1,
        Contents: [{ Key: 'demo.png' }],
      };
    },
  };

  const hasObjects = await s3.hasExistingObjects();

  assert.equal(hasObjects, true);
  assert.deepEqual(sentInputs, [{
    Bucket: 'bucket-1',
    MaxKeys: 1,
  }]);
});

test('S3 清空 bucket 时会按分页结果逐批删除整个 bucket 的对象', async () => {
  class FakeListObjectsV2Command {
    constructor(input) {
      this.input = input;
    }
  }

  class FakeDeleteObjectsCommand {
    constructor(input) {
      this.input = input;
    }
  }

  S3Storage.__setCommandsForTest({
    ListObjectsV2Command: FakeListObjectsV2Command,
    DeleteObjectsCommand: FakeDeleteObjectsCommand,
  });

  const s3 = new S3Storage({
    bucket: 'bucket-1',
    accessKeyId: 'key',
    secretAccessKey: 'secret',
  });

  const deletePayloads = [];
  let listCallCount = 0;
  s3.s3 = {
    async send(command) {
      if (command instanceof FakeListObjectsV2Command) {
        listCallCount += 1;
        if (listCallCount === 1) {
          return {
            Contents: [{ Key: 'a.png' }, { Key: 'b.png' }],
          };
        }
        if (listCallCount === 2) {
          return {
            Contents: [{ Key: 'c.png' }],
          };
        }
        return {
          Contents: [],
        };
      }

      deletePayloads.push(command.input);
      return {};
    },
  };

  const result = await s3.clearBucketContents();

  assert.deepEqual(result, { deletedCount: 3 });
  assert.equal(listCallCount, 3);
  assert.deepEqual(deletePayloads, [
    {
      Bucket: 'bucket-1',
      Delete: {
        Objects: [{ Key: 'a.png' }, { Key: 'b.png' }],
        Quiet: true,
      },
    },
    {
      Bucket: 'bucket-1',
      Delete: {
        Objects: [{ Key: 'c.png' }],
        Quiet: true,
      },
    },
  ]);
});

test('S3 清空 bucket 时会按每批最多 1000 个 key 删除', async () => {
  class FakeListObjectsV2Command {
    constructor(input) {
      this.input = input;
    }
  }

  class FakeDeleteObjectsCommand {
    constructor(input) {
      this.input = input;
    }
  }

  S3Storage.__setCommandsForTest({
    ListObjectsV2Command: FakeListObjectsV2Command,
    DeleteObjectsCommand: FakeDeleteObjectsCommand,
  });

  const s3 = new S3Storage({
    bucket: 'bucket-1',
    accessKeyId: 'key',
    secretAccessKey: 'secret',
  });

  const deleteBatchSizes = [];
  let listCallCount = 0;
  s3.s3 = {
    async send(command) {
      if (command instanceof FakeListObjectsV2Command) {
        listCallCount += 1;
        if (listCallCount === 1) {
          return {
            Contents: Array.from({ length: 1000 }, (_, index) => ({ Key: `file-${index}` })),
          };
        }
        if (listCallCount === 2) {
          return {
            Contents: [{ Key: 'file-1000' }],
          };
        }
        return {
          Contents: [],
        };
      }

      deleteBatchSizes.push(command.input.Delete.Objects.length);
      return {};
    },
  };

  const result = await s3.clearBucketContents();

  assert.deepEqual(result, { deletedCount: 1001 });
  assert.deepEqual(deleteBatchSizes, [1000, 1]);
});

test('S3 清空空 bucket 时保持幂等且不会发起删除请求', async () => {
  class FakeListObjectsV2Command {
    constructor(input) {
      this.input = input;
    }
  }

  class FakeDeleteObjectsCommand {
    constructor(input) {
      this.input = input;
    }
  }

  S3Storage.__setCommandsForTest({
    ListObjectsV2Command: FakeListObjectsV2Command,
    DeleteObjectsCommand: FakeDeleteObjectsCommand,
  });

  const s3 = new S3Storage({
    bucket: 'bucket-1',
    accessKeyId: 'key',
    secretAccessKey: 'secret',
  });

  let deleteCallCount = 0;
  s3.s3 = {
    async send(command) {
      if (command instanceof FakeDeleteObjectsCommand) {
        deleteCallCount += 1;
      }

      return {
        Contents: [],
      };
    },
  };

  const result = await s3.clearBucketContents();

  assert.deepEqual(result, { deletedCount: 0 });
  assert.equal(deleteCallCount, 0);
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
