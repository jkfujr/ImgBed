/**
 * 更新系统配置字段
 */

function applySystemConfigUpdates(cfg, body = {}) {
  if (body.security !== undefined) {
    cfg.security = cfg.security || {};

    if (body.security.corsOrigin !== undefined) {
      cfg.security.corsOrigin = String(body.security.corsOrigin);
    }
    if (body.security.guestUploadEnabled !== undefined) {
      cfg.security.guestUploadEnabled = Boolean(body.security.guestUploadEnabled);
    }
    if (body.security.uploadPassword !== undefined) {
      cfg.security.uploadPassword = String(body.security.uploadPassword);
    }
  }

  if (body.storage?.default !== undefined) {
    cfg.storage = cfg.storage || {};
    cfg.storage.default = String(body.storage.default);
  }

  if (body.server?.port !== undefined) {
    cfg.server = cfg.server || {};
    cfg.server.port = Number(body.server.port);
  }

  updateUploadConfig(cfg, body.upload);

  if (body.performance !== undefined) {
    cfg.performance = cfg.performance || {};
    if (body.performance.s3Multipart !== undefined) {
      cfg.performance.s3Multipart = {
        enabled: Boolean(body.performance.s3Multipart.enabled),
        concurrency: Number(body.performance.s3Multipart.concurrency) || 4,
        maxConcurrency: Number(body.performance.s3Multipart.maxConcurrency) || 8,
        minPartSize: 5242880,
      };
    }
  }
}

/**
 * 更新上传配置字段
 */
function updateUploadConfig(cfg, uploadBody) {
  if (!uploadBody) return;

  cfg.upload = cfg.upload || {};

  if (uploadBody.fullCheckIntervalHours !== undefined) {
    cfg.upload.fullCheckIntervalHours = Math.max(1, Number(uploadBody.fullCheckIntervalHours) || 6);
  }
  if (uploadBody.defaultSizeLimitMB !== undefined) {
    cfg.upload.defaultSizeLimitMB = Number(uploadBody.defaultSizeLimitMB) || 10;
  }
  if (uploadBody.defaultChunkSizeMB !== undefined) {
    cfg.upload.defaultChunkSizeMB = Number(uploadBody.defaultChunkSizeMB) || 5;
  }
  if (uploadBody.defaultMaxChunks !== undefined) {
    cfg.upload.defaultMaxChunks = Number(uploadBody.defaultMaxChunks) || 0;
  }
  if (uploadBody.defaultMaxLimitMB !== undefined) {
    cfg.upload.defaultMaxLimitMB = Number(uploadBody.defaultMaxLimitMB) || 100;
  }
  if (uploadBody.enableSizeLimit !== undefined) {
    cfg.upload.enableSizeLimit = Boolean(uploadBody.enableSizeLimit);
  }
  if (uploadBody.enableChunking !== undefined) {
    cfg.upload.enableChunking = Boolean(uploadBody.enableChunking);
  }
  if (uploadBody.enableMaxLimit !== undefined) {
    cfg.upload.enableMaxLimit = Boolean(uploadBody.enableMaxLimit);
  }
}

/**
 * 更新存储渠道字段
 */
function applyStorageFieldUpdates(existing, body) {
  if (body.name !== undefined) existing.name = String(body.name).trim();
  if (body.enabled !== undefined) existing.enabled = Boolean(body.enabled);
  if (body.allowUpload !== undefined) existing.allowUpload = Boolean(body.allowUpload);
  if (body.weight !== undefined) existing.weight = Number(body.weight) || 1;

  // 配额字段处理
  if (body.enableQuota !== undefined) {
    if (body.enableQuota) {
      existing.quotaLimitGB = Number(body.quotaLimitGB) || 10;
      existing.disableThresholdPercent = Math.max(1, Math.min(100, Number(body.disableThresholdPercent) || 95));
    } else {
      existing.quotaLimitGB = null;
    }
  }

  // 大小限制字段
  if (body.enableSizeLimit !== undefined) existing.enableSizeLimit = Boolean(body.enableSizeLimit);
  if (body.sizeLimitMB !== undefined) existing.sizeLimitMB = Number(body.sizeLimitMB) || 10;

  // 分片上传字段
  if (body.enableChunking !== undefined) existing.enableChunking = Boolean(body.enableChunking);
  if (body.chunkSizeMB !== undefined) existing.chunkSizeMB = Number(body.chunkSizeMB) || 5;
  if (body.maxChunks !== undefined) existing.maxChunks = Number(body.maxChunks) || 0;

  // 最大限制字段
  if (body.enableMaxLimit !== undefined) existing.enableMaxLimit = Boolean(body.enableMaxLimit);
  if (body.maxLimitMB !== undefined) existing.maxLimitMB = Number(body.maxLimitMB) || 100;
}

export {
  applySystemConfigUpdates,
  updateUploadConfig,
  applyStorageFieldUpdates,
};
