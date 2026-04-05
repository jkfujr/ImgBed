import { readSystemConfig } from './config-io.js';

/**
 * 从数据库全量统计配额使用情况
 */
async function calculateQuotaStatsFromDB(db, configPath) {
  // 全量从数据库统计
  const result = await db
    .selectFrom('files')
    .select(['size', 'storage_config', 'storage_channel'])
    .execute();

  // 读取配置获取渠道列表，用于兼容旧文件统计
  const cfg = readSystemConfig(configPath);
  const channels = cfg.storage?.storages || [];

  // 按类型分组，统计每个类型下的渠道ID列表
  const channelsByType = {};
  for (const ch of channels) {
    if (!channelsByType[ch.type]) {
      channelsByType[ch.type] = [];
    }
    channelsByType[ch.type].push(ch.id);
  }

  const stats = {}; // { [instanceId]: totalBytes }

  for (const row of result) {
    let cfg;
    try {
      cfg = JSON.parse(row.storage_config || '{}');
    } catch (e) {
      continue;
    }
    const instanceId = cfg.instance_id;
    const fileSize = Number(row.size) || 0;

    if (instanceId) {
      // 情况1：已有 instance_id，直接统计
      stats[instanceId] = (stats[instanceId] || 0) + fileSize;
    } else {
      // 情况2：旧文件没有 instance_id，尝试根据类型推断
      // 如果该类型只有一个渠道，则归到这个渠道
      const type = row.storage_channel;
      if (type && channelsByType[type] && channelsByType[type].length === 1) {
        const fallbackId = channelsByType[type][0];
        stats[fallbackId] = (stats[fallbackId] || 0) + fileSize;
      }
    }
  }

  return stats;
}

export { calculateQuotaStatsFromDB, };
