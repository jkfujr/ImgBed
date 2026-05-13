import { normalizeRemoteIoProcessError } from '../bootstrap/entry-error-policy.js';

const ALLOWED_PROTOCOLS = new Set(['http:', 'https:', 'socks:', 'socks4:', 'socks4a:', 'socks5:', 'socks5h:']);
const DEFAULT_TIMEOUT_MS = 30000;
const DEFAULT_MAX_CACHE_SIZE = 50;

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

function createProxyFetcher({
  fetchImpl = globalThis.fetch,
  ProxyAgentImpl,
  maxCacheSize = DEFAULT_MAX_CACHE_SIZE,
  defaultTimeout = DEFAULT_TIMEOUT_MS,
} = {}) {
  const agentCache = new Map();
  const cacheOrder = [];

  function addToCache(key, agent) {
    if (agentCache.size >= maxCacheSize && cacheOrder.length > 0) {
      const oldestKey = cacheOrder.shift();
      agentCache.delete(oldestKey);
    }
    agentCache.set(key, agent);
    cacheOrder.push(key);
  }

  async function getProxyAgent(proxyUrl) {
    const normalized = normalizeProxyUrl(proxyUrl);
    if (!normalized) {
      return null;
    }

    if (!agentCache.has(normalized.url)) {
      addToCache(normalized.url, new ProxyAgentImpl(normalized.url));
    }

    return agentCache.get(normalized.url);
  }

  return async function fetchWithProxy(url, options = {}, proxyUrl = '') {
    const requestOptions = { ...options };

    // 添加默认超时（如果未指定）
    if (!options.signal && !options.timeout) {
      requestOptions.signal = AbortSignal.timeout(defaultTimeout);
    }

    const agent = await getProxyAgent(proxyUrl);
    if (agent) {
      requestOptions.dispatcher = agent;
    }

    try {
      return await fetchImpl(url, requestOptions);
    } catch (error) {
      throw normalizeRemoteIoProcessError(error, {
        source: 'network:proxy',
      });
    }
  };
}

export {
  normalizeProxyUrl,
  createProxyFetcher,
};
