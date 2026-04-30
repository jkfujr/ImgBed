function firstHeaderValue(value) {
  if (Array.isArray(value)) {
    return value[0] || '';
  }
  return value || '';
}

function firstForwardedIp(value) {
  const raw = firstHeaderValue(value);
  return raw.split(',')[0]?.trim() || '';
}

function getRequestIp(req) {
  const cloudflareIp = firstForwardedIp(req.get?.('cf-connecting-ip') || req.headers?.['cf-connecting-ip']);
  if (cloudflareIp) return cloudflareIp;

  const forwardedIp = firstForwardedIp(req.get?.('x-forwarded-for') || req.headers?.['x-forwarded-for']);
  if (forwardedIp) return forwardedIp;

  return req.ip || req.socket?.remoteAddress || req.connection?.remoteAddress || 'unknown';
}

export {
  firstForwardedIp,
  getRequestIp,
};
