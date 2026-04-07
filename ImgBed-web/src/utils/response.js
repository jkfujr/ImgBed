/**
 * 统一错误响应常量
 * 与后端 ErrorResponse 保持一致
 */
export const ErrorResponse = {
  // 401 未授权错误
  UNAUTHORIZED: {
    code: 401,
    message: '未授权：缺失有效的 Bearer Token'
  },

  UNAUTHORIZED_GUEST_DISABLED: {
    code: 401,
    message: '未授权：请登录后上传，或联系管理员开启访客上传功能'
  },

  UNAUTHORIZED_PASSWORD_REQUIRED: {
    code: 401,
    message: '未授权：需要上传密码'
  },

  UNAUTHORIZED_PASSWORD_WRONG: {
    code: 401,
    message: '未授权：上传密码错误'
  },

  // 403 禁止访问错误
  FORBIDDEN: {
    code: 403,
    message: '禁止访问：权限不足'
  },

  // 网络错误
  NETWORK_ERROR: {
    code: 0,
    message: '网络连接失败，请检查后端服务是否启动'
  },

  CONNECTION_ABORTED: {
    code: 0,
    message: '请求超时或连接中断，请稍后重试'
  },

  GENERIC_ERROR: {
    code: 0,
    message: '网络错误'
  }
};

/**
 * 错误码映射
 */
export const ErrorCode = {
  ERR_NETWORK: 'ERR_NETWORK',
  ERR_CONNECTION_ABORTED: 'ERR_CONNECTION_ABORTED',
  ECONNABORTED: 'ECONNABORTED'
};

/**
 * 根据错误码获取错误响应
 * @param {string} errorCode - 错误码
 * @returns {Object} 错误响应对象
 */
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

/**
 * 构造增强的错误对象
 * @param {string} message - 错误消息
 * @param {number} code - 错误码
 * @returns {Error} 增强的错误对象
 */
export const createEnhancedError = (message, code = 0) => {
  const enhancedError = new Error(message);
  enhancedError.response = {
    data: {
      code,
      message
    }
  };
  return enhancedError;
};
