const assert = require('node:assert/strict');
const proxyModule = require('../src/network/proxy');

async function testNormalizeProxyUrlAcceptsHttp() {
  const result = proxyModule.normalizeProxyUrl('http://127.0.0.1:7890');
  assert.equal(result.protocol, 'http:');
  assert.equal(result.hostname, '127.0.0.1');
  assert.equal(result.port, '7890');
}

async function testNormalizeProxyUrlAcceptsSocks5() {
  const result = proxyModule.normalizeProxyUrl('socks5://user:pass@127.0.0.1:1080');
  assert.equal(result.protocol, 'socks5:');
  assert.equal(result.username, 'user');
  assert.equal(result.password, 'pass');
}

async function testNormalizeProxyUrlRejectsBareHost() {
  assert.throws(
    () => proxyModule.normalizeProxyUrl('tg.example.com'),
    /代理地址格式无效/
  );
}

async function testFetchWithProxyPassesAgent() {
  let capturedOptions = null;
  class FakeProxyAgent {
    constructor(url) {
      this.url = url;
    }
  }

  proxyModule.__setDepsForTest({
    fetch: async (_url, options) => {
      capturedOptions = options;
      return { ok: true, json: async () => ({ ok: true }) };
    },
    ProxyAgent: FakeProxyAgent,
  });

  try {
    await proxyModule.fetchWithProxy('https://api.telegram.org/botxxx/getMe', { method: 'GET' }, 'socks5://127.0.0.1:1080');
    assert.equal(capturedOptions.method, 'GET');
    assert.ok(capturedOptions.agent instanceof FakeProxyAgent);
    assert.equal(capturedOptions.agent.url, 'socks5://127.0.0.1:1080');
  } finally {
    proxyModule.__resetDepsForTest();
  }
}

async function main() {
  await testNormalizeProxyUrlAcceptsHttp();
  await testNormalizeProxyUrlAcceptsSocks5();
  await testNormalizeProxyUrlRejectsBareHost();
  await testFetchWithProxyPassesAgent();
  console.log('proxy utils tests passed');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
