import { AppError } from '../errors/AppError.js';
import { verifyApiToken } from '../utils/apiToken.js';
import { verifyToken } from '../utils/jwt.js';
import { ErrorResponse } from '../utils/response.js';

const SESSION_INVALID_JWT_REASONS = new Set(['expired', 'signature_invalid', 'malformed']);

const extractBearerToken = (req) => {
  const authHeader = req.get('Authorization');
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return null;
  }

  return authHeader.slice('Bearer '.length);
};

const looksLikeJwt = (token) => {
  return typeof token === 'string' && token.split('.').length === 3;
};

const buildUnauthorizedResponse = (reason) => {
  switch (reason) {
    case 'AUTH_SESSION_INVALID':
      return ErrorResponse.UNAUTHORIZED_SESSION_INVALID;
    case 'AUTH_ROLE_INVALID':
      return ErrorResponse.UNAUTHORIZED_ROLE_INVALID;
    case 'AUTH_MISSING':
    default:
      return ErrorResponse.UNAUTHORIZED;
  }
};

const buildForbiddenResponse = (message) => {
  if (!message) {
    return ErrorResponse.FORBIDDEN;
  }

  return {
    code: 403,
    message,
  };
};

const getRequestIp = (req) => {
  return req.get('x-forwarded-for') || req.get('cf-connecting-ip') || req.ip || 'unknown';
};

const resolveJwtFailureReason = ({ rawToken, jwtResult }) => {
  if (!rawToken) {
    return 'AUTH_MISSING';
  }

  if (looksLikeJwt(rawToken) && SESSION_INVALID_JWT_REASONS.has(jwtResult?.reason)) {
    return 'AUTH_SESSION_INVALID';
  }

  return null;
};

const resolveAuth = async (req) => {
  const rawToken = extractBearerToken(req);
  if (!rawToken) {
    return {
      auth: null,
      failureReason: 'AUTH_MISSING',
    };
  }

  const jwtResult = await verifyToken(rawToken);
  if (jwtResult.ok) {
    if (jwtResult.payload.role !== 'admin') {
      return {
        auth: null,
        failureReason: 'AUTH_ROLE_INVALID',
      };
    }

    const auth = {
      type: 'admin_jwt',
      role: 'admin',
      username: jwtResult.payload.username,
      permissions: ['*'],
    };

    req.auth = auth;
    req.user = jwtResult.payload;
    return {
      auth,
      failureReason: null,
    };
  }

  if (jwtResult.reason === 'unexpected' && looksLikeJwt(rawToken)) {
    throw new AppError(500, '鉴权系统异常，请稍后重试');
  }

  const jwtFailureReason = resolveJwtFailureReason({
    rawToken,
    jwtResult,
  });
  if (jwtFailureReason) {
    return {
      auth: null,
      failureReason: jwtFailureReason,
    };
  }

  const apiTokenAuth = await verifyApiToken(rawToken, getRequestIp(req));
  if (apiTokenAuth) {
    req.auth = apiTokenAuth;
    return {
      auth: apiTokenAuth,
      failureReason: null,
    };
  }

  return {
    auth: null,
    failureReason: 'AUTH_MISSING',
  };
};

const adminAuth = async (req, res, next) => {
  const { auth, failureReason } = await resolveAuth(req);

  if (!auth) {
    return res.status(401).json(buildUnauthorizedResponse(failureReason));
  }

  if (auth.role !== 'admin') {
    return res.status(401).json(buildUnauthorizedResponse('AUTH_ROLE_INVALID'));
  }

  return next();
};

const requireAuth = async (req, res, next) => {
  const { auth, failureReason } = await resolveAuth(req);

  if (!auth) {
    return res.status(401).json(buildUnauthorizedResponse(failureReason));
  }

  return next();
};

const requirePermission = (permission) => {
  return async (req, res, next) => {
    let auth = req.auth;
    let failureReason = null;

    if (!auth) {
      const resolved = await resolveAuth(req);
      auth = resolved.auth;
      failureReason = resolved.failureReason;
    }

    if (!auth) {
      return res.status(401).json(buildUnauthorizedResponse(failureReason));
    }

    const permissions = auth.permissions || [];
    if (auth.role === 'admin' || permissions.includes('*') || permissions.includes(permission)) {
      return next();
    }

    return res.status(403).json(buildForbiddenResponse(`缺少权限：${permission}`));
  };
};

export {
  adminAuth,
  buildUnauthorizedResponse,
  extractBearerToken,
  looksLikeJwt,
  resolveAuth,
  requireAuth,
  requirePermission,
};
