import { calculateQuotaPercent, fmtSize } from '../../utils/formatters.js';

const DEFAULT_DISABLE_THRESHOLD_PERCENT = 95;

function isQuotaLimited(quotaLimitGB) {
  return Boolean(quotaLimitGB) && quotaLimitGB > 0;
}

function getStorageUsageColor(percent, disableThresholdPercent = DEFAULT_DISABLE_THRESHOLD_PERCENT) {
  if (percent >= disableThresholdPercent) return 'error';
  if (percent > 70) return 'warning';
  return 'primary';
}

function buildStorageUsageDisplay({
  usedBytes,
  quotaLimitGB,
  disableThresholdPercent = DEFAULT_DISABLE_THRESHOLD_PERCENT,
}) {
  if (!isQuotaLimited(quotaLimitGB)) {
    return {
      limited: false,
      text: `${fmtSize(usedBytes)} / 无限制`,
    };
  }

  const percent = calculateQuotaPercent(usedBytes, quotaLimitGB);

  return {
    limited: true,
    percent,
    color: getStorageUsageColor(percent, disableThresholdPercent),
    text: `${fmtSize(usedBytes)} / ${quotaLimitGB} GB`,
  };
}

export {
  buildStorageUsageDisplay,
  getStorageUsageColor,
  isQuotaLimited,
};
