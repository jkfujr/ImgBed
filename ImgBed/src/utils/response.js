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
};

export const send401WithBodyConsumption = (req, res, errorResponse) => {
  let consumed = false;

  req.on('data', () => {
    // 主动消费请求体，避免代理层提前重置连接。
  });

  req.on('end', () => {
    if (!consumed) {
      consumed = true;
      res.status(401).json(errorResponse);
    }
  });
};

export const success = (data, message = '操作成功') => ({
  code: 0,
  message,
  data,
});

export const error = (code, message) => ({
  code,
  message,
});
