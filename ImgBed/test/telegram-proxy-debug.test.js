const assert = require('node:assert/strict');
const net = require('node:net');
const TelegramStorage = require('../src/storage/telegram');
const { normalizeProxyUrl, fetchWithProxy } = require('../src/network/proxy');

const config = {
  chatId: process.env.TELEGRAM_DEBUG_CHAT_ID || '',
  botToken: process.env.TELEGRAM_DEBUG_BOT_TOKEN || '',
  proxyUrl: process.env.TELEGRAM_DEBUG_PROXY_URL || '',
};

function maskValue(value, visibleStart = 3, visibleEnd = 2) {
  if (!value) {
    return '';
  }
  if (value.length <= visibleStart + visibleEnd) {
    return '*'.repeat(value.length);
  }
  return `${value.slice(0, visibleStart)}***${value.slice(-visibleEnd)}`;
}

function assertRequiredEnv() {
  const missing = [];
  if (!config.chatId) missing.push('TELEGRAM_DEBUG_CHAT_ID');
  if (!config.botToken) missing.push('TELEGRAM_DEBUG_BOT_TOKEN');
  if (!config.proxyUrl) missing.push('TELEGRAM_DEBUG_PROXY_URL');

  if (missing.length) {
    throw new Error(`缺少调试环境变量: ${missing.join(', ')}`);
  }
}

function logSection(title, payload) {
  console.log(`\n[${title}]`);
  if (payload !== undefined) {
    console.log(payload);
  }
}

function tcpProbe(host, port, timeoutMs = 3000) {
  return new Promise((resolve) => {
    const socket = net.connect({ host, port: Number(port) });
    let settled = false;

    const finish = (result) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(result);
    };

    socket.setTimeout(timeoutMs);
    socket.once('connect', () => finish({ ok: true }));
    socket.once('timeout', () => finish({ ok: false, stage: 'tcp', message: `TCP 连接超时（${timeoutMs}ms）` }));
    socket.once('error', (error) => finish({ ok: false, stage: 'tcp', message: error.message, code: error.code || '' }));
  });
}

async function runStep(title, fn) {
  const startedAt = Date.now();
  try {
    const result = await fn();
    const duration = Date.now() - startedAt;
    logSection(title, JSON.stringify({ ok: true, durationMs: duration, result }, null, 2));
    return { ok: true, durationMs: duration, result };
  } catch (error) {
    const duration = Date.now() - startedAt;
    logSection(title, JSON.stringify({
      ok: false,
      durationMs: duration,
      name: error?.name || '',
      message: error?.message || '',
      code: error?.code || error?.cause?.code || '',
      type: error?.type || '',
      errno: error?.errno || error?.cause?.errno || '',
      causeName: error?.cause?.name || '',
      causeMessage: error?.cause?.message || '',
      stack: error?.stack || '',
    }, null, 2));
    return { ok: false, durationMs: duration, error };
  }
}

async function main() {
  assertRequiredEnv();

  logSection('配置', JSON.stringify({
    chatId: maskValue(config.chatId),
    botToken: maskValue(config.botToken, 6, 4),
    proxyUrl: config.proxyUrl,
  }, null, 2));

  const normalized = normalizeProxyUrl(config.proxyUrl);
  assert.equal(normalized.protocol, 'socks5:');
  logSection('代理解析', JSON.stringify(normalized, null, 2));

  const tcpResult = await tcpProbe(normalized.hostname, normalized.port || '1080');
  logSection('代理端口探测', JSON.stringify(tcpResult, null, 2));

  const directGetMeUrl = `https://api.telegram.org/bot${config.botToken}/getMe`;

  await runStep('fetchWithProxy + 10秒超时 getMe', async () => {
    const response = await fetchWithProxy(directGetMeUrl, {
      headers: {
        'User-Agent': 'Claude-Telegram-Debug/1.0',
      },
      signal: AbortSignal.timeout(10000),
    }, config.proxyUrl);

    const body = await response.text();
    return {
      status: response.status,
      statusText: response.statusText,
      body,
    };
  });

  await runStep('fetchWithProxy + 30秒超时 getMe', async () => {
    const response = await fetchWithProxy(directGetMeUrl, {
      headers: {
        'User-Agent': 'Claude-Telegram-Debug/1.0',
      },
      signal: AbortSignal.timeout(30000),
    }, config.proxyUrl);

    const body = await response.text();
    return {
      status: response.status,
      statusText: response.statusText,
      body,
    };
  });

  await runStep('TelegramStorage.testConnection', async () => {
    const storage = new TelegramStorage(config);
    return storage.testConnection();
  });
}

main().catch((error) => {
  console.error('\n[脚本执行失败]');
  console.error(error);
  process.exit(1);
});
