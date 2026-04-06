import { parseStorageConfig } from '../files/storage-artifacts.js';
import TelegramStorage from '../../storage/telegram.js';
import DiscordStorage from '../../storage/discord.js';
import S3Storage from '../../storage/s3.js';
import ExternalStorage from '../../storage/external.js';

function resolveFileStorage(fileRecord, { storageManager, config }) {
  const configObj = parseStorageConfig(fileRecord.storage_config);
  const instanceId = configObj.instance_id;
  let storage = storageManager.getStorage(instanceId);

  if (!storage) {
    storage = resolveLegacyStorage(fileRecord, configObj, config);
  }

  if (!storage) {
    const error = new Error(`图床渠道调度失败，丢失底层映射处理器及备用配置: ${instanceId || fileRecord.storage_channel}`);
    error.status = 500;
    throw error;
  }

  return { storage, storageKey: fileRecord.storage_key };
}

function resolveTelegramLegacyProxy(configObj, config) {
  const originalMeta = configObj.original_meta || {};
  if (originalMeta.TelegramProxyUrl) return originalMeta.TelegramProxyUrl;
  if (configObj.telegram_proxy_url) return configObj.telegram_proxy_url;

  const storages = config?.storage?.storages || [];
  const matchedTelegramStorage = storages.find((storage) => storage.type === 'telegram' && storage.config?.botToken === originalMeta.TelegramBotToken);
  if (matchedTelegramStorage?.config?.proxyUrl) {
    return matchedTelegramStorage.config.proxyUrl;
  }

  const defaultTelegramStorage = storages.find((storage) => storage.type === 'telegram' && storage.config?.proxyUrl);
  return defaultTelegramStorage?.config?.proxyUrl || '';
}

function resolveLegacyStorage(fileRecord, configObj, config) {
  const channel = fileRecord.storage_channel;

  if (channel === 'telegram' && fileRecord.telegram_bot_token) {
    return new TelegramStorage({
      botToken: fileRecord.telegram_bot_token,
      proxyUrl: resolveTelegramLegacyProxy(configObj, config),
    });
  }

  if (channel === 'discord') {
    const dToken = configObj.original_meta?.DiscordBotToken || config.storage?.discordLegacyToken || '';
    return new DiscordStorage({ botToken: dToken });
  }

  if (channel === 's3' && configObj.legacy_s3) {
    return new S3Storage(configObj.legacy_s3);
  }

  if (channel === 'external' || channel === 'huggingface') {
    const storage = new ExternalStorage({ baseUrl: '' });
    const originalUrl = configObj.original_meta?.Url || fileRecord.storage_key;
    return { ...storage, _overrideKey: originalUrl };
  }

  return null;
}

function parseRangeHeader(rangeHeader, totalSize) {
  if (!rangeHeader) {
    return { start: 0, end: totalSize - 1, isPartial: false };
  }

  const parts = rangeHeader.replace(/bytes=/, '').split('-');
  const reqStart = parseInt(parts[0], 10);
  const reqEnd = parts[1] ? parseInt(parts[1], 10) : totalSize - 1;

  if (isNaN(reqStart)) {
    return { start: 0, end: totalSize - 1, isPartial: false };
  }

  const start = reqStart;
  const end = Math.min(reqEnd, totalSize - 1);

  return { start, end, isPartial: true };
}

function buildStreamHeaders({ fileRecord, start, end, isPartial, totalSize }) {
  const headers = new Headers();
  headers.set('Content-Type', fileRecord.mime_type || 'application/octet-stream');
  headers.set('Cache-Control', 'public, max-age=31536000');
  headers.set('Content-Disposition', `inline; filename*=UTF-8''${encodeURIComponent(fileRecord.original_name)}`);

  if (isPartial) {
    headers.set('Content-Range', `bytes ${start}-${end}/${totalSize}`);
    headers.set('Content-Length', String(end - start + 1));
    headers.set('Accept-Ranges', 'bytes');
  } else {
    headers.set('Content-Length', String(totalSize));
    headers.set('Accept-Ranges', 'bytes');
  }

  return headers;
}

export { resolveFileStorage,
  resolveLegacyStorage,
  parseRangeHeader,
  buildStreamHeaders, };
