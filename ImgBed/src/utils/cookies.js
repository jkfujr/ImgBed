function decodeCookieValue(value) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function parseCookieHeader(cookieHeader = '') {
  const cookies = {};
  const parts = String(cookieHeader || '').split(';');

  for (const part of parts) {
    const separatorIndex = part.indexOf('=');
    if (separatorIndex <= 0) {
      continue;
    }

    const name = part.slice(0, separatorIndex).trim();
    const value = part.slice(separatorIndex + 1).trim();
    if (name) {
      cookies[name] = decodeCookieValue(value);
    }
  }

  return cookies;
}

function readCookie(req, name) {
  return parseCookieHeader(req.get('Cookie') || '')[name] || null;
}

function serializeCookie(name, value, options = {}) {
  const parts = [`${name}=${encodeURIComponent(value)}`];

  if (options.maxAge !== undefined) {
    parts.push(`Max-Age=${Number(options.maxAge) || 0}`);
  }

  parts.push(`Path=${options.path || '/'}`);

  if (options.httpOnly) {
    parts.push('HttpOnly');
  }
  if (options.sameSite) {
    parts.push(`SameSite=${options.sameSite}`);
  }
  if (options.secure) {
    parts.push('Secure');
  }

  return parts.join('; ');
}

export {
  decodeCookieValue,
  parseCookieHeader,
  readCookie,
  serializeCookie,
};
