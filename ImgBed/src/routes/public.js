import express from 'express';
import { readRuntimeConfig } from '../config/index.js';
import {
  GUEST_UPLOAD_TICKET_COOKIE,
  GUEST_UPLOAD_TICKET_MAX_AGE_SECONDS,
  createGuestUploadTicket,
  isGuestUploadPasswordValid,
  verifyGuestUploadTicket,
} from '../services/auth/guest-upload-ticket.js';
import { readCookie, serializeCookie } from '../utils/cookies.js';
import { ErrorResponse, success } from '../utils/response.js';

const publicApp = express.Router();

function isSecureRequest(req) {
  return req.secure || req.get('x-forwarded-proto') === 'https';
}

async function hasValidGuestUploadTicket(req, uploadPassword) {
  const ticket = readCookie(req, GUEST_UPLOAD_TICKET_COOKIE);
  return verifyGuestUploadTicket(ticket, uploadPassword);
}

/**
 * 获取访客上传配置（公开接口，无需认证）
 * GET /api/public/guest-upload-config
 */
publicApp.get('/guest-upload-config', async (req, res) => {
  const cfg = readRuntimeConfig();
  const guestUploadEnabled = cfg.security?.guestUploadEnabled || false;
  const requirePassword = guestUploadEnabled && !!cfg.security?.uploadPassword;
  const hasGuestUploadTicket = requirePassword
    ? await hasValidGuestUploadTicket(req, cfg.security.uploadPassword)
    : false;

  return res.json(success({
    guestUploadEnabled,
    requirePassword,
    hasGuestUploadTicket,
  }));
});

publicApp.post('/guest-upload-ticket', async (req, res) => {
  const cfg = readRuntimeConfig();
  const guestUploadEnabled = cfg.security?.guestUploadEnabled || false;
  const uploadPassword = cfg.security?.uploadPassword || '';

  if (!guestUploadEnabled) {
    return res.status(401).json(ErrorResponse.UNAUTHORIZED_GUEST_DISABLED);
  }

  if (!uploadPassword) {
    return res.json(success({ hasGuestUploadTicket: false }, '访客上传无需密码'));
  }

  const providedPassword = String(req.body?.password || '');
  if (!isGuestUploadPasswordValid(providedPassword, uploadPassword)) {
    return res.status(401).json(ErrorResponse.UNAUTHORIZED_PASSWORD_WRONG);
  }

  const ticket = await createGuestUploadTicket(uploadPassword);
  res.setHeader('Set-Cookie', serializeCookie(GUEST_UPLOAD_TICKET_COOKIE, ticket, {
    httpOnly: true,
    sameSite: 'Lax',
    path: '/',
    maxAge: GUEST_UPLOAD_TICKET_MAX_AGE_SECONDS,
    secure: isSecureRequest(req),
  }));

  return res.json(success({ hasGuestUploadTicket: true }, '访客上传密码验证成功'));
});

export default publicApp;
