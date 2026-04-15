import { createLogger } from '../../utils/logger.js';

const log = createLogger('storage');

function getUsageStat(usageStats, storageId) {
  if (usageStats instanceof Map) {
    return usageStats.get(storageId) || { uploadCount: 0, fileCount: 0 };
  }

  if (usageStats && typeof usageStats === 'object') {
    return usageStats[storageId] || { uploadCount: 0, fileCount: 0 };
  }

  return { uploadCount: 0, fileCount: 0 };
}

class UploadSelector {
  constructor({
    logger = log,
    getConfig = () => ({}),
    getDefaultStorageId = () => null,
    listStorageEntries = () => [],
    canUpload = () => false,
    getUsageStats = () => new Map(),
    random = Math.random,
  } = {}) {
    this.log = logger;
    this.getConfig = getConfig;
    this.getDefaultStorageId = getDefaultStorageId;
    this.listStorageEntries = listStorageEntries;
    this.canUpload = canUpload;
    this.getUsageStats = getUsageStats;
    this.random = random;
    this.roundRobinIndex = 0;
  }

  selectUploadChannel(preferredType = null, excludeIds = []) {
    const config = this.getConfig() || {};
    const strategy = config.loadBalanceStrategy || 'default';
    let uploadableChannels = this.listStorageEntries()
      .filter(([id]) => !excludeIds.includes(id) && this.canUpload(id))
      .map(([id, entry]) => ({ id, type: entry.type, weight: entry.weight || 1 }));

    const scope = config.loadBalanceScope || 'global';
    if (scope === 'byType' && preferredType) {
      const enabledTypes = Array.isArray(config.loadBalanceEnabledTypes)
        ? config.loadBalanceEnabledTypes
        : [];
      uploadableChannels = uploadableChannels.filter((channel) =>
        channel.type === preferredType && enabledTypes.includes(channel.type)
      );
    }

    if (uploadableChannels.length === 0) {
      this.log.warn('当前没有可上传的存储渠道');
      return null;
    }

    switch (strategy) {
      case 'round-robin':
        return this.selectRoundRobin(uploadableChannels);
      case 'random':
        return this.selectRandom(uploadableChannels);
      case 'least-used':
        return this.selectLeastUsed(uploadableChannels);
      case 'weighted':
        return this.selectWeighted(uploadableChannels, config);
      case 'default':
      default: {
        const defaultId = this.getDefaultStorageId();
        if (defaultId && !excludeIds.includes(defaultId) && this.canUpload(defaultId)) {
          return defaultId;
        }
        return uploadableChannels[0]?.id || null;
      }
    }
  }

  selectRoundRobin(channels) {
    const selected = channels[this.roundRobinIndex % channels.length];
    this.roundRobinIndex++;
    return selected.id;
  }

  selectRandom(channels) {
    const index = Math.floor(this.random() * channels.length);
    return channels[index].id;
  }

  selectLeastUsed(channels) {
    const usageStats = this.getUsageStats();
    let minCount = Infinity;
    let selectedId = channels[0].id;

    for (const { id } of channels) {
      const stat = getUsageStat(usageStats, id);
      if (stat.fileCount < minCount) {
        minCount = stat.fileCount;
        selectedId = id;
      }
    }

    return selectedId;
  }

  selectWeighted(channels, config = {}) {
    const weights = config.loadBalanceWeights || {};
    let totalWeight = 0;
    const weightedChannels = [];

    for (const { id, weight: channelWeight } of channels) {
      const configWeight = Number(weights[id]) || 1;
      const weight = channelWeight !== 1 ? channelWeight : configWeight;
      totalWeight += weight;
      weightedChannels.push({ id, accumulated: totalWeight });
    }

    if (totalWeight === 0) {
      return channels[0].id;
    }

    const random = this.random() * totalWeight;
    for (const { id, accumulated } of weightedChannels) {
      if (random <= accumulated) {
        return id;
      }
    }

    return weightedChannels[weightedChannels.length - 1].id;
  }
}

export { UploadSelector };
