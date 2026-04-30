import crypto from 'crypto';

import { getLastKnownGoodConfig } from '../../config/index.js';
import { signToken, verifyToken } from '../../utils/jwt.js';

const GUEST_UPLOAD_TICKET_COOKIE = 'imgbed_guest_upload_ticket';
const GUEST_UPLOAD_TICKET_MAX_AGE_SECONDS = 2 * 60 * 60;
const GUEST_UPLOAD_TICKET_EXPIRES_IN = '2h';

function getJwtSecret() {
  const secret = getLastKnownGoodConfig().jwt?.secret;
  if (typeof secret !== 'string' || !secret.trim()) {
    throw new Error('运行配置缺少 jwt.secret，无法签发访客上传票据');
  }
  return secret;
}

function buildGuestUploadPasswordVersion(uploadPassword) {
  return crypto
    .createHmac('sha256', getJwtSecret())
    .update(String(uploadPassword || ''), 'utf8')
    .digest('hex');
}

function isGuestUploadPasswordValid(providedPassword, uploadPassword) {
  const providedBuffer = Buffer.from(String(providedPassword || ''), 'utf8');
  const expectedBuffer = Buffer.from(String(uploadPassword || ''), 'utf8');

  if (providedBuffer.length !== expectedBuffer.length) {
    return false;
  }

  return crypto.timingSafeEqual(providedBuffer, expectedBuffer);
}

async function createGuestUploadTicket(uploadPassword) {
  return signToken({
    type: 'guest_upload',
    scope: 'upload:image',
    passwordVersion: buildGuestUploadPasswordVersion(uploadPassword),
  }, {
    expiresIn: GUEST_UPLOAD_TICKET_EXPIRES_IN,
  });
}

async function verifyGuestUploadTicket(ticket, uploadPassword) {
  if (!ticket) {
    return false;
  }

  const result = await verifyToken(ticket);
  if (!result.ok) {
    return false;
  }

  const payload = result.payload || {};
  return (
    payload.type === 'guest_upload' &&
    payload.scope === 'upload:image' &&
    payload.passwordVersion === buildGuestUploadPasswordVersion(uploadPassword)
  );
}

export {
  GUEST_UPLOAD_TICKET_COOKIE,
  GUEST_UPLOAD_TICKET_MAX_AGE_SECONDS,
  buildGuestUploadPasswordVersion,
  createGuestUploadTicket,
  isGuestUploadPasswordValid,
  verifyGuestUploadTicket,
};
