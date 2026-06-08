const BYTES_PER_GB = 1024 ** 3;
const DEFAULT_DISABLE_THRESHOLD_PERCENT = 95;

function normalizeDisableThresholdPercent(value) {
  const percent = Number(value);
  if (!Number.isFinite(percent) || percent <= 0) {
    return DEFAULT_DISABLE_THRESHOLD_PERCENT;
  }
  return percent;
}

function isQuotaLimited(quotaLimitGB) {
  const quota = Number(quotaLimitGB);
  return Number.isFinite(quota) && quota > 0;
}

function getQuotaDisableThresholdBytes({
  quotaLimitGB,
  disableThresholdPercent = DEFAULT_DISABLE_THRESHOLD_PERCENT,
} = {}) {
  if (!isQuotaLimited(quotaLimitGB)) {
    return null;
  }

  return Number(quotaLimitGB)
    * BYTES_PER_GB
    * (normalizeDisableThresholdPercent(disableThresholdPercent) / 100);
}

function isQuotaThresholdReached(storage = {}, usedBytes = 0) {
  const thresholdBytes = getQuotaDisableThresholdBytes(storage);
  if (thresholdBytes === null) {
    return false;
  }

  const currentUsedBytes = Number(usedBytes) || 0;
  return currentUsedBytes >= thresholdBytes;
}

export {
  BYTES_PER_GB,
  DEFAULT_DISABLE_THRESHOLD_PERCENT,
  getQuotaDisableThresholdBytes,
  isQuotaLimited,
  isQuotaThresholdReached,
  normalizeDisableThresholdPercent,
};
