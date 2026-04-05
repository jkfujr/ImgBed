import fetch from 'node-fetch';
import { ProxyAgent } from 'proxy-agent';

const agentCache = new Map();
const ALLOWED_PROTOCOLS = new Set(['http:', 'https:', 'socks:', 'socks4:', 'socks4a:', 'socks5:', 'socks5h:']);

function normalizeProxyUrl(proxyUrl) {
  if (!proxyUrl) {
    return null;
  }

  const raw = String(proxyUrl).trim();
  if (!raw) {
    return null;
  }

  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error('代理地址格式无效，请填写完整代理地址，例如 http://127.0.0.1:7890 或 socks5://127.0.0.1:1080');
  }

  if (!ALLOWED_PROTOCOLS.has(parsed.protocol)) {
    throw new Error(`不支持的代理协议: ${parsed.protocol}`);
  }

  if (!parsed.hostname) {
    throw new Error('代理地址缺少主机名');
  }

  return {
    url: parsed.toString(),
    protocol: parsed.protocol,
    hostname: parsed.hostname,
    port: parsed.port || '',
    username: parsed.username || '',
    password: parsed.password || '',
  };
}

async function getProxyAgent(proxyUrl) {
  const normalized = normalizeProxyUrl(proxyUrl);
  if (!normalized) {
    return null;
  }

  if (!agentCache.has(normalized.url)) {
    agentCache.set(normalized.url, new ProxyAgent(normalized.url));
  }

  return agentCache.get(normalized.url);
}

async function fetchWithProxy(url, options = {}, proxyUrl = '') {
  const requestOptions = { ...options };
  const agent = await getProxyAgent(proxyUrl);
  if (agent) {
    requestOptions.agent = agent;
  }

  return fetch(url, requestOptions);
}

function __setDepsForTest({ fetch: mockFetch, ProxyAgent: mockProxyAgent } = {}) {
  // 测试钩子保持不变
  agentCache.clear();
}

function __resetDepsForTest() {
  agentCache.clear();
}

export {
  normalizeProxyUrl,
  getProxyAgent,
  fetchWithProxy,
  __setDepsForTest,
  __resetDepsForTest,
};
