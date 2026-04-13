import { strict as assert } from 'node:assert';

import TelegramStorage from '../ImgBed/src/storage/telegram.js';

function createStorage() {
  return new TelegramStorage({
    botToken: 'token',
    chatId: '-1000000000000',
  });
}

async function testMissingRemoteMessageIsTreatedAsSuccess() {
  const storage = createStorage();
  storage.requestTelegram = async () => ({
    json: async () => ({
      ok: false,
      description: 'Bad Request: message to delete not found',
    }),
  });

  const deleted = await storage.delete('file-id', {
    messageId: 8,
    chatId: '-5244533769',
  });

  assert.equal(deleted, true, '远端消息已不存在时应按幂等删除成功处理');
  console.log('  [OK] TelegramStorage.delete：远端消息缺失按成功处理');
}

async function testOtherDeleteFailureStillReturnsFalse() {
  const storage = createStorage();
  storage.requestTelegram = async () => ({
    json: async () => ({
      ok: false,
      description: 'Bad Request: message cannot be deleted',
    }),
  });

  const deleted = await storage.delete('file-id', {
    messageId: 8,
    chatId: '-5244533769',
  });

  assert.equal(deleted, false, '非幂等删除失败仍应保留失败结果');
  console.log('  [OK] TelegramStorage.delete：其他删除错误仍返回失败');
}

async function testMissingMessageIdStillReturnsFalse() {
  const storage = createStorage();
  const deleted = await storage.delete('file-id', {});

  assert.equal(deleted, false, '缺少 messageId 时仍应返回失败，避免误删索引');
  console.log('  [OK] TelegramStorage.delete：缺少 messageId 时仍返回失败');
}

async function run() {
  console.log('\n== telegram delete idempotent tests ==');
  await testMissingRemoteMessageIsTreatedAsSuccess();
  await testOtherDeleteFailureStillReturnsFalse();
  await testMissingMessageIdStillReturnsFalse();
  console.log('\ntelegram-delete-idempotent tests passed\n');
}

run().catch((error) => {
  console.error('\n测试失败:', error);
  process.exit(1);
});
