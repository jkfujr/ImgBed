/**
 * 应用错误基类
 */
class AppError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
    this.name = this.constructor.name;
  }
}

class ValidationError extends AppError {
  constructor(message = '请求参数无效') { super(400, message); }
}

class AuthError extends AppError {
  constructor(message = '未授权访问') { super(401, message); }
}

class ForbiddenError extends AppError {
  constructor(message = '禁止访问') { super(403, message); }
}

class NotFoundError extends AppError {
  constructor(message = '资源不存在') { super(404, message); }
}

class StorageError extends AppError {
  constructor(message = '存储操作失败', storageId = null) {
    super(500, message);
    this.storageId = storageId;
  }
}

class QuotaExceededError extends AppError {
  constructor(message = '存储配额已满') { super(403, message); }
}

export {
  AppError,
  ValidationError,
  AuthError,
  ForbiddenError,
  NotFoundError,
  StorageError,
  QuotaExceededError,
};
