/**
 * 统一错误响应常量
 * 与后端 ErrorResponse 保持一致
 */
export const ErrorResponse = {
  UNAUTHORIZED: {
    code: 401,
    reason: 'AUTH_MISSING',
    message: '未授权：缺少有效的 Bearer 令牌',
  },

  UNAUTHORIZED_SESSION_INVALID: {
    code: 401,
    reason: 'AUTH_SESSION_INVALID',
    message: '登录态已失效，请重新登录',
  },

  UNAUTHORIZED_ROLE_INVALID: {
    code: 401,
    reason: 'AUTH_ROLE_INVALID',
    message: '鉴权失败：需要管理员身份',
  },

  UNAUTHORIZED_GUEST_DISABLED: {
    code: 401,
    reason: 'AUTH_GUEST_UPLOAD_DISABLED',
    message: '未授权：请登录后上传，或联系管理员开启访客上传功能',
  },

  UNAUTHORIZED_PASSWORD_REQUIRED: {
    code: 401,
    reason: 'AUTH_UPLOAD_PASSWORD_REQUIRED',
    message: '未授权：需要上传密码',
  },

  UNAUTHORIZED_PASSWORD_WRONG: {
    code: 401,
    reason: 'AUTH_UPLOAD_PASSWORD_WRONG',
    message: '未授权：上传密码错误',
  },

  FORBIDDEN: {
    code: 403,
    message: '禁止访问：权限不足',
  },

  NETWORK_ERROR: {
    code: 0,
    message: '网络连接失败，请检查后端服务是否启动',
  },

  CONNECTION_ABORTED: {
    code: 0,
    message: '请求超时或连接中断，请稍后重试',
  },

  GENERIC_ERROR: {
    code: 0,
    message: '网络错误',
  },
};

export const ErrorCode = {
  ERR_NETWORK: 'ERR_NETWORK',
  ERR_CONNECTION_ABORTED: 'ERR_CONNECTION_ABORTED',
  ECONNABORTED: 'ECONNABORTED',
};

export const getErrorResponseByCode = (errorCode) => {
  switch (errorCode) {
    case ErrorCode.ERR_NETWORK:
      return ErrorResponse.NETWORK_ERROR;
    case ErrorCode.ERR_CONNECTION_ABORTED:
    case ErrorCode.ECONNABORTED:
      return ErrorResponse.CONNECTION_ABORTED;
    default:
      return ErrorResponse.GENERIC_ERROR;
  }
};

export const createEnhancedError = (message, code = 0) => {
  const enhancedError = new Error(message);
  enhancedError.response = {
    data: {
      code,
      message,
    },
  };
  return enhancedError;
};
