/**
 * 统一响应工具模块
 * 提供标准化的HTTP响应格式和错误消息
 */

/**
 * 标准错误响应格式
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
  }
};

/**
 * 发送401响应并消费请求体
 * 用于处理大文件上传时的401错误,避免代理层连接重置
 *
 * @param {import('express').Request} req - Express请求对象
 * @param {import('express').Response} res - Express响应对象
 * @param {Object} errorResponse - 错误响应对象,包含code和message
 */
export const send401WithBodyConsumption = (req, res, errorResponse) => {
  // 先消费请求体,避免代理层连接重置
  // 当上传大文件时,如果不消费请求体就返回响应,会违反HTTP协议规范
  // 导致Vite代理层强制关闭连接,前端收到ERR_CONNECTION_RESET
  let consumed = false;

  req.on('data', () => {
    // 消费数据但不处理
  });

  req.on('end', () => {
    if (!consumed) {
      consumed = true;
      res.status(401).json(errorResponse);
    }
  });
};

/**
 * 标准成功响应
 * @param {*} data - 响应数据
 * @param {string} message - 可选的成功消息
 */
export const success = (data, message = '操作成功') => ({
  code: 0,
  message,
  data
});

/**
 * 标准错误响应
 * @param {number} code - 错误码
 * @param {string} message - 错误消息
 */
export const error = (code, message) => ({
  code,
  message
});
