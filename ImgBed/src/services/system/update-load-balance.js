/**
 * 更新负载均衡配置字段
 */

const VALID_STRATEGIES = ['default', 'round-robin', 'random', 'least-used', 'weighted'];

/**
 * 验证并更新负载均衡配置
 * @param {Object} cfg - 系统配置对象
 * @param {Object} body - 请求体
 * @returns {Object|null} 如果验证失败返回错误对象，否则返回 null
 */
function updateLoadBalanceConfig(cfg, body) {
  const { strategy, scope, enabledTypes, weights, failoverEnabled } = body;

  if (!cfg.storage) cfg.storage = {};

  // 验证策略
  if (strategy !== undefined) {
    if (!VALID_STRATEGIES.includes(strategy)) {
      return { code: 400, message: `无效的策略: ${strategy}` };
    }
    cfg.storage.loadBalanceStrategy = strategy;
  }

  // 更新其他字段
  if (scope !== undefined) {
    cfg.storage.loadBalanceScope = scope;
  }
  if (enabledTypes !== undefined) {
    cfg.storage.loadBalanceEnabledTypes = enabledTypes;
  }
  if (weights !== undefined) {
    cfg.storage.loadBalanceWeights = weights;
  }
  if (failoverEnabled !== undefined) {
    cfg.storage.failoverEnabled = Boolean(failoverEnabled);
  }

  return null; // 验证通过
}

module.exports = {
  updateLoadBalanceConfig,
  VALID_STRATEGIES,
};
