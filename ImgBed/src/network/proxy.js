import { ProxyAgent } from 'proxy-agent';
import { createProxyFetcher } from './proxy-core.js';

const fetchWithProxy = createProxyFetcher({
  fetchImpl: globalThis.fetch,
  ProxyAgentImpl: ProxyAgent,
});

export {
  fetchWithProxy,
};
