import { normalizeRemoteIoProcessError } from '../bootstrap/entry-error-policy.js';

/**
 * 存储驱动错误处理辅助工具
 * 复用现有的 entry-error-policy.js 网络错误分类
 */

/**
 * 获取用户友好的网络错误消息
 */
export function getFriendlyNetworkErrorMessage(error) {
  const code = error?.code;
  const name = error?.name;

  // 超时错误
  if (name === 'TimeoutError' || name === 'AbortError' || code === 'ETIMEDOUT') {
    return '连接超时，请检查网络连接';
  }

  // 连接被拒绝
  if (code === 'ECONNREFUSED') {
    return '连接被拒绝，请检查服务地址和端口';
  }

  // DNS 解析失败
  if (code === 'ENOTFOUND' || code === 'EAI_AGAIN') {
    return '域名解析失败，请检查网络配置';
  }

  // 网络不可达
  if (code === 'ENETUNREACH' || code === 'EHOSTUNREACH') {
    return '网络不可达，请检查网络配置';
  }

  // 连接重置
  if (code === 'ECONNRESET' || code === 'EPIPE') {
    return '连接中断，请重试';
  }

  return null;
}

/**
 * 获取用户友好的 HTTP 错误消息
 */
export function getFriendlyHttpErrorMessage(status, errorData = {}) {
  if (status === 401) {
    return '认证失败，请检查访问密钥配置';
  }

  if (status === 403) {
    return '权限不足，请检查访问权限配置';
  }

  if (status === 404) {
    return '资源不存在，请检查配置';
  }

  if (status === 413) {
    return '文件过大，超出服务限制';
  }

  if (status === 429) {
    return '请求过于频繁，请稍后重试';
  }

  if (status >= 500) {
    return '服务暂时不可用，请稍后重试';
  }

  return errorData.message || errorData.description || null;
}

/**
 * 统一的 testConnection 错误处理包装器
 *
 * @param {Function} testFn - 测试连接的异步函数
 * @param {Object} options - 配置选项
 * @param {string} options.source - 错误来源标识（如 's3', 'telegram'）
 * @returns {Promise<{ok: boolean, message: string}>}
 */
export async function wrapTestConnection(testFn, options = {}) {
  try {
    return await testFn();
  } catch (error) {
    // 使用现有的网络错误规范化
    const normalizedError = normalizeRemoteIoProcessError(error, {
      source: options.source || 'storage'
    });

    // 尝试获取友好的错误消息
    let friendlyMessage = getFriendlyNetworkErrorMessage(normalizedError);

    // 如果有 HTTP 状态码，尝试获取 HTTP 错误消息
    if (!friendlyMessage && normalizedError.status) {
      friendlyMessage = getFriendlyHttpErrorMessage(
        normalizedError.status,
        normalizedError.data || {}
      );
    }

    // 如果没有友好消息，使用原始消息
    const message = friendlyMessage || normalizedError.message || '连接失败';

    return {
      ok: false,
      message: `连接失败: ${message}`
    };
  }
}

/**
 * 处理 HTTP 响应并提取错误信息
 *
 * @param {Response} response - Fetch API 响应对象
 * @returns {Promise<any>} 响应数据
 * @throws {Error} 如果响应不成功
 */
export async function handleHttpResponse(response) {
  if (response.ok) {
    return await response.json().catch(() => ({}));
  }

  let errorData = {};
  try {
    errorData = await response.json();
  } catch {
    // 忽略 JSON 解析错误
  }

  const error = new Error(
    errorData.message || errorData.description || response.statusText
  );
  error.status = response.status;
  error.data = errorData;

  throw error;
}
