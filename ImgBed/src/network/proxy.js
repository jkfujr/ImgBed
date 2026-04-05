let fetchImpl = null;
let ProxyAgentImpl = null;
const agentCache = new Map();
const ALLOWED_PROTOCOLS = new Set(['http:', 'https:', 'socks:', 'socks4:', 'socks4a:', 'socks5:', 'socks5h:']);

async function ensureDeps() {
  if (!fetchImpl) {
    const fetchModule = await import('node-fetch');
    fetchImpl = fetchModule.default;
  }

  if (!ProxyAgentImpl) {
    const proxyAgentModule = await import('proxy-agent');
    ProxyAgentImpl = proxyAgentModule.ProxyAgent || proxyAgentModule.default;
  }
}

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

  await ensureDeps();

  if (!agentCache.has(normalized.url)) {
    agentCache.set(normalized.url, new ProxyAgentImpl(normalized.url));
  }

  return agentCache.get(normalized.url);
}

async function fetchWithProxy(url, options = {}, proxyUrl = '') {
  await ensureDeps();

  const requestOptions = { ...options };
  const agent = await getProxyAgent(proxyUrl);
  if (agent) {
    requestOptions.agent = agent;
  }

  return fetchImpl(url, requestOptions);
}

function __setDepsForTest({ fetch, ProxyAgent } = {}) {
  if (fetch !== undefined) {
    fetchImpl = fetch;
  }
  if (ProxyAgent !== undefined) {
    ProxyAgentImpl = ProxyAgent;
  }
  agentCache.clear();
}

function __resetDepsForTest() {
  fetchImpl = null;
  ProxyAgentImpl = null;
  agentCache.clear();
}

module.exports = {
  normalizeProxyUrl,
  getProxyAgent,
  fetchWithProxy,
  __setDepsForTest,
  __resetDepsForTest,
};
