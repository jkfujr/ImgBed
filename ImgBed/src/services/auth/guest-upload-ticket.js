import crypto from 'crypto';

import { signToken, verifyToken } from '../../utils/jwt.js';

const GUEST_UPLOAD_TICKET_COOKIE = 'imgbed_guest_upload_ticket';
const GUEST_UPLOAD_TICKET_MAX_AGE_SECONDS = 2 * 60 * 60;
const GUEST_UPLOAD_TICKET_EXPIRES_IN = '2h';

function isGuestUploadPasswordValid(providedPassword, uploadPassword) {
  const providedBuffer = Buffer.from(String(providedPassword || ''), 'utf8');
  const expectedBuffer = Buffer.from(String(uploadPassword || ''), 'utf8');

  if (providedBuffer.length !== expectedBuffer.length) {
    return false;
  }

  return crypto.timingSafeEqual(providedBuffer, expectedBuffer);
}

async function createGuestUploadTicket(ticketRevision) {
  return signToken({
    type: 'guest_upload',
    scope: 'upload:image',
    ticketRevision: String(ticketRevision || ''),
  }, {
    expiresIn: GUEST_UPLOAD_TICKET_EXPIRES_IN,
  });
}

async function verifyGuestUploadTicket(ticket, ticketRevision) {
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
    payload.ticketRevision === String(ticketRevision || '')
  );
}

export {
  GUEST_UPLOAD_TICKET_COOKIE,
  GUEST_UPLOAD_TICKET_MAX_AGE_SECONDS,
  createGuestUploadTicket,
  isGuestUploadPasswordValid,
  verifyGuestUploadTicket,
};
