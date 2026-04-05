const assert = require('node:assert/strict');
const path = require('path');

const proxyModulePath = require.resolve('../src/network/proxy');
const telegramModulePath = require.resolve('../src/storage/telegram');

function loadTelegramStorageWithStub(stubFetchWithProxy) {
  delete require.cache[telegramModulePath];
  delete require.cache[proxyModulePath];
  require.cache[proxyModulePath] = {
    id: proxyModulePath,
    filename: proxyModulePath,
    loaded: true,
    exports: { fetchWithProxy: stubFetchWithProxy },
  };
  return require(telegramModulePath);
}

function restoreModules() {
  delete require.cache[telegramModulePath];
  delete require.cache[proxyModulePath];
}

async function testTelegramUsesOfficialApiUrlWithProxy() {
  const calls = [];
  const TelegramStorage = loadTelegramStorageWithStub(async (url, options, proxyUrl) => {
    calls.push({ url, options, proxyUrl });
    return {
      ok: true,
      status: 200,
      statusText: 'OK',
      async json() {
        return {
          ok: true,
          result: { first_name: 'demo', username: 'bot_demo' },
        };
      },
    };
  });

  try {
    const storage = new TelegramStorage({
      botToken: 'token-123',
      chatId: 'chat-1',
      proxyUrl: 'socks5://127.0.0.1:1080',
    });

    const result = await storage.testConnection();
    assert.equal(result.ok, true);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, 'https://api.telegram.org/bottoken-123/getMe');
    assert.equal(calls[0].proxyUrl, 'socks5://127.0.0.1:1080');
  } finally {
    restoreModules();
  }
}

async function testTelegramGetFileContentUsesOfficialFileDomain() {
  const calls = [];
  const TelegramStorage = loadTelegramStorageWithStub(async (url, options, proxyUrl) => {
    calls.push({ url, options, proxyUrl });
    if (url.includes('/getFile?')) {
      return {
        ok: true,
        async json() {
          return {
            ok: true,
            result: { file_path: 'documents/test.png' },
          };
        },
      };
    }

    return {
      ok: true,
      status: 200,
      statusText: 'OK',
      body: 'stream',
      async json() {
        return {};
      },
    };
  });

  try {
    const storage = new TelegramStorage({
      botToken: 'token-456',
      proxyUrl: 'http://127.0.0.1:7890',
    });

    const response = await storage.getFileContent('file-1');
    assert.equal(response.ok, true);
    assert.equal(calls.length, 2);
    assert.equal(calls[0].url, 'https://api.telegram.org/bottoken-456/getFile?file_id=file-1');
    assert.equal(calls[1].url, 'https://api.telegram.org/file/bottoken-456/documents/test.png');
    assert.equal(calls[1].proxyUrl, 'http://127.0.0.1:7890');
  } finally {
    restoreModules();
  }
}

async function testTelegramReturnsProxyValidationError() {
  const TelegramStorage = loadTelegramStorageWithStub(async () => {
    throw new Error('代理地址格式无效，请填写完整代理地址，例如 http://127.0.0.1:7890 或 socks5://127.0.0.1:1080');
  });

  try {
    const storage = new TelegramStorage({
      botToken: 'token-789',
      proxyUrl: 'bad-proxy',
    });

    const result = await storage.testConnection();
    assert.equal(result.ok, false);
    assert.match(result.message, /代理地址格式无效/);
  } finally {
    restoreModules();
  }
}

async function testTelegramReturnsTimeoutHintForAbortError() {
  const TelegramStorage = loadTelegramStorageWithStub(async () => {
    const error = new Error('The operation was aborted.');
    error.name = 'AbortError';
    throw error;
  });

  try {
    const storage = new TelegramStorage({
      botToken: 'token-timeout',
      proxyUrl: 'socks5://127.0.0.1:1080',
    });

    const result = await storage.testConnection();
    assert.equal(result.ok, false);
    assert.equal(result.message, '连接失败: 请求超时，请检查代理是否可访问 Telegram');
  } finally {
    restoreModules();
  }
}

async function testTelegramReturnsTimeoutHintForTimedOutConnection() {
  const TelegramStorage = loadTelegramStorageWithStub(async () => {
    const error = new Error('connect ETIMEDOUT 103.226.246.99:443');
    error.code = 'ETIMEDOUT';
    throw error;
  });

  try {
    const storage = new TelegramStorage({
      botToken: 'token-timeout-2',
      proxyUrl: 'socks5://127.0.0.1:1080',
    });

    const result = await storage.testConnection();
    assert.equal(result.ok, false);
    assert.equal(result.message, '连接失败: 连接 Telegram 超时，请检查代理链路');
  } finally {
    restoreModules();
  }
}

async function main() {
  await testTelegramUsesOfficialApiUrlWithProxy();
  await testTelegramGetFileContentUsesOfficialFileDomain();
  await testTelegramReturnsProxyValidationError();
  await testTelegramReturnsTimeoutHintForAbortError();
  await testTelegramReturnsTimeoutHintForTimedOutConnection();
  console.log('telegram storage tests passed');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
