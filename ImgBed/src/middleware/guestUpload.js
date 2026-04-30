import { readRuntimeConfig } from '../config/index.js';
import {
  GUEST_UPLOAD_TICKET_COOKIE,
  verifyGuestUploadTicket,
} from '../services/auth/guest-upload-ticket.js';
import { readCookie } from '../utils/cookies.js';
import { ErrorResponse, send401WithBodyConsumption } from '../utils/response.js';

/**
 * 访客上传中间件
 * 检查是否允许访客上传，以及是否需要密码验证
 */
export const guestUploadAuth = async (req, res, next) => {
  const cfg = readRuntimeConfig();
  const guestUploadEnabled = cfg.security?.guestUploadEnabled || false;
  const uploadPassword = cfg.security?.uploadPassword || '';
  const ticketRevision = cfg.security.guestUploadTicketRevision;

  // 检查是否有有效的 Bearer Token
  const authHeader = req.get('Authorization');
  const hasToken = authHeader && authHeader.startsWith('Bearer ');

  // 如果有 Token，直接继续走原有的认证流程
  if (hasToken) {
    return next();
  }

  // 没有 Token，检查是否允许访客上传
  if (!guestUploadEnabled) {
    send401WithBodyConsumption(req, res, ErrorResponse.UNAUTHORIZED_GUEST_DISABLED);
    return;
  }

  // 开启了访客上传，检查是否设置了上传密码
  if (uploadPassword) {
    const ticket = readCookie(req, GUEST_UPLOAD_TICKET_COOKIE);
    const hasValidTicket = await verifyGuestUploadTicket(ticket, ticketRevision);

    if (!hasValidTicket) {
      send401WithBodyConsumption(req, res, ErrorResponse.UNAUTHORIZED_PASSWORD_REQUIRED);
      return;
    }
  }

  // 访客上传已开启，且密码验证通过（或无需密码）
  // 设置一个访客身份标识
  req.auth = {
    type: 'guest',
    role: 'guest',
    username: 'guest',
    permissions: ['upload:image']
  };

  return next();
};
