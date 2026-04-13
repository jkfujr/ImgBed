import { strict as assert } from 'node:assert';

import TelegramStorage from '../ImgBed/src/storage/telegram.js';
import { resolveStoredFileSize } from '../ImgBed/src/routes/upload.js';

async function testTelegramPutReturnsActualRemoteSize() {
  const storage = new TelegramStorage({
    botToken: 'token',
    chatId: '123456',
  });

  storage.sendFile = async () => ({
    ok: true,
    result: {
      message_id: 42,
      photo: [
        { file_id: 'small', file_unique_id: 'small', file_size: 111 },
        { file_id: 'large', file_unique_id: 'large', file_size: 222 },
      ],
    },
  });

  const result = await storage.put(Buffer.from('origin-image'), {
    fileName: 'test.jpg',
    mimeType: 'image/jpeg',
  });

  assert.equal(result.storageKey, 'large', '应选择 Telegram 返回的最大尺寸文件作为 storageKey');
  assert.equal(result.size, 222, '上传结果应暴露 Telegram 实际存储大小');
  assert.deepEqual(result.deleteToken, {
    messageId: 42,
    chatId: '123456',
  }, '应把删除消息所需最小凭证收口到 deleteToken');
  assert.equal(result.raw, null, '默认不暴露厂商原始回包');
  console.log('  [OK] TelegramStorage.put：返回 canonical put 结构');
}

function testResolveStoredFileSizePrefersRemoteSize() {
  assert.equal(
    resolveStoredFileSize({ size: 222 }, 4096),
    222,
    '存在远端实际尺寸时应优先使用远端尺寸'
  );
  assert.equal(
    resolveStoredFileSize({}, 4096),
    4096,
    '缺少远端尺寸时应回退到原始上传尺寸'
  );
  console.log('  [OK] resolveStoredFileSize：优先远端尺寸，缺省时回退原始尺寸');
}

function testTelegramParsesTotalSizeFromContentRange() {
  const storage = new TelegramStorage({
    botToken: 'token',
    chatId: '123456',
  });

  assert.equal(
    storage.parseTotalSizeFromContentRange('bytes 0-1023/4096'),
    4096,
    '应正确解析 Content-Range 总长度'
  );
  assert.equal(
    storage.parseTotalSizeFromContentRange(null),
    null,
    '缺少 Content-Range 时应返回 null'
  );
  console.log('  [OK] TelegramStorage：Content-Range 总长度解析正确');
}

async function run() {
  console.log('\n== telegram size alignment tests ==');
  await testTelegramPutReturnsActualRemoteSize();
  testResolveStoredFileSizePrefersRemoteSize();
  testTelegramParsesTotalSizeFromContentRange();
  console.log('\ntelegram-size-alignment tests passed\n');
}

run().catch((error) => {
  console.error('\n测试失败:', error);
  process.exit(1);
});
