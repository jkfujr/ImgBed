import crypto from 'crypto';
import path from 'path';

import { sqlite } from '../../database/index.js';
import { ValidationError } from '../../errors/AppError.js';
import { ensureExistingDirectoryPath, normalizeDirectoryPath } from '../../utils/directory-path.js';
import { createLogger } from '../../utils/logger.js';
import { readImageMetadata } from '../files/image-metadata.js';

const log = createLogger('upload');
const ALLOWED_EXTENSIONS = [
  // 传统格式
  '.jpg', '.jpeg', '.png', '.gif', '.bmp', '.ico',
  // 现代格式
  '.webp', '.avif', '.apng',
  // 矢量格式
  '.svg',
  // 移动设备格式
  '.heic', '.heif',
  // 专业格式
  '.tiff', '.tif'
];

function validateUploadFile(file) {
  if (!file || typeof file === 'string') {
    throw new ValidationError('未检测到文件上传或字段错误');
  }
}

function normalizeUploadDirectory(input, { db = sqlite } = {}) {
  try {
    const normalized = normalizeDirectoryPath(input);
    ensureExistingDirectoryPath(normalized, db);
    return normalized;
  } catch (error) {
    throw new ValidationError(`directory 参数不合法：${error.message}`);
  }
}

async function prepareUploadFile(file, {
  logger = log,
  readImageMetadataFn = readImageMetadata,
} = {}) {
  const buffer = file.buffer;
  const originalName = file.originalname || 'blob';
  const mimeType = file.mimetype || 'application/octet-stream';
  const rawExt = path.extname(originalName).toLowerCase();
  const mimeExt = mimeType ? `.${mimeType.split('/')[1]}`.replace('.jpeg', '.jpg') : '';
  const extension = rawExt || mimeExt || '';
  const isImageMime = mimeType.startsWith('image/');
  const isImageExt = ALLOWED_EXTENSIONS.includes(extension.toLowerCase());

  if (!isImageMime || !isImageExt) {
    throw new ValidationError(`非法文件格式: ${mimeType || '未知'} (${extension || '无后缀'})。本站仅支持图片托管。`);
  }

  let width = null;
  let height = null;
  let exif = null;

  try {
    const metadata = await readImageMetadataFn(buffer);
    width = metadata.width;
    height = metadata.height;
    exif = metadata.exif;
  } catch (error) {
    logger.warn({ err: error, filename: file.originalname }, '提取文件元数据失败');
  }

  const hash = crypto.createHash('sha1').update(buffer).digest('hex').substring(0, 12);
  const baseNameOnly = originalName.replace(/\.[^/.]+$/, '');
  const safeBaseName = baseNameOnly.replace(/[^a-zA-Z0-9]/g, '_').substring(0, 24);
  const fileId = `${hash}_${safeBaseName || 'file'}${extension}`;

  return {
    buffer,
    originalName,
    extension,
    fileId,
    newFileName: fileId,
    mimeType,
    width,
    height,
    exif,
  };
}

export {
  ALLOWED_EXTENSIONS,
  normalizeUploadDirectory,
  prepareUploadFile,
  validateUploadFile,
};
