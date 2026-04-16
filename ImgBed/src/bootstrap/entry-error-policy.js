const RECOVERABLE_PROCESS_ERROR_TAG = Symbol.for('imgbed.recoverable-process-error');

const RECOVERABLE_REMOTE_IO_CODES = new Set([
  'ECONNRESET',
  'ETIMEDOUT',
  'ENOTFOUND',
  'ECONNREFUSED',
  'EPIPE',
  'EAI_AGAIN',
  'UND_ERR_ABORTED',
  'UND_ERR_CONNECT_TIMEOUT',
  'UND_ERR_SOCKET',
]);

const RECOVERABLE_REMOTE_IO_NAMES = new Set([
  'AbortError',
  'TimeoutError',
  'ConnectTimeoutError',
]);

const RECOVERABLE_REMOTE_IO_MESSAGE_PATTERNS = [
  /socket hang up/i,
  /premature close/i,
  /\baborted\b/i,
  /client network socket disconnected/i,
  /write epipe/i,
  /read econnreset/i,
];

function ensureError(error) {
  if (error instanceof Error) {
    return error;
  }

  const normalizedError = new Error(String(error?.message || error));

  if (error && typeof error === 'object') {
    Object.assign(normalizedError, error);
  }

  return normalizedError;
}

function getRecoverableProcessErrorTag(error) {
  return error?.[RECOVERABLE_PROCESS_ERROR_TAG] || null;
}

function markRecoverableProcessError(error, { category = 'unknown', source = 'unknown' } = {}) {
  const normalizedError = ensureError(error);
  const currentTag = getRecoverableProcessErrorTag(normalizedError);

  if (currentTag) {
    return normalizedError;
  }

  Object.defineProperty(normalizedError, RECOVERABLE_PROCESS_ERROR_TAG, {
    value: {
      recoverable: true,
      category,
      source,
    },
    configurable: true,
  });

  return normalizedError;
}

function collectErrorCandidates(error) {
  const normalizedError = ensureError(error);
  const candidates = [normalizedError];

  if (normalizedError.cause) {
    candidates.push(normalizedError.cause);
  }

  if (Array.isArray(normalizedError.errors)) {
    candidates.push(...normalizedError.errors);
  }

  return candidates.filter(Boolean);
}

function isRecoverableRemoteIoError(error) {
  for (const candidate of collectErrorCandidates(error)) {
    if (RECOVERABLE_REMOTE_IO_CODES.has(candidate?.code)) {
      return true;
    }

    if (RECOVERABLE_REMOTE_IO_NAMES.has(candidate?.name)) {
      return true;
    }

    const message = String(candidate?.message || '');
    if (RECOVERABLE_REMOTE_IO_MESSAGE_PATTERNS.some((pattern) => pattern.test(message))) {
      return true;
    }
  }

  return false;
}

function normalizeRemoteIoProcessError(error, { source = 'unknown' } = {}) {
  const normalizedError = ensureError(error);

  if (getRecoverableProcessErrorTag(normalizedError)) {
    return normalizedError;
  }

  if (isRecoverableRemoteIoError(normalizedError)) {
    return markRecoverableProcessError(normalizedError, {
      category: 'remote_io',
      source,
    });
  }

  return normalizedError;
}

function classifyEntryError(error, channel = 'uncaughtException') {
  const normalizedError = ensureError(error);
  const recoverableTag = getRecoverableProcessErrorTag(normalizedError);

  if (recoverableTag) {
    return {
      type: 'recoverable',
      channel,
      error: normalizedError,
      category: recoverableTag.category,
      source: recoverableTag.source,
      shouldExit: false,
      exitCode: null,
      logLevel: 'error',
      message: channel === 'unhandledRejection'
        ? '已捕获可恢复的未处理 Promise 拒绝'
        : '已捕获可恢复的未捕获异常',
    };
  }

  if (channel === 'listen' && normalizedError?.code === 'EADDRINUSE') {
    return {
      type: 'startup_address_in_use',
      channel,
      error: normalizedError,
      category: 'startup',
      source: 'http_listen',
      shouldExit: true,
      exitCode: 1,
      logLevel: 'fatal',
      message: '应用启动失败',
    };
  }

  if (channel === 'unhandledRejection') {
    return {
      type: 'unhandled_rejection',
      channel,
      error: normalizedError,
      category: 'process',
      source: 'promise',
      shouldExit: false,
      exitCode: null,
      logLevel: 'error',
      message: '出现未处理的 Promise 拒绝',
    };
  }

  return {
    type: channel === 'startup' || channel === 'listen'
      ? 'startup_failure'
      : 'fatal_uncaught_exception',
    channel,
    error: normalizedError,
    category: channel === 'startup' || channel === 'listen' ? 'startup' : 'process',
    source: channel,
    shouldExit: true,
    exitCode: 1,
    logLevel: 'fatal',
    message: channel === 'startup' || channel === 'listen'
      ? '应用启动失败'
      : '发生致命未捕获异常',
  };
}

export {
  classifyEntryError,
  getRecoverableProcessErrorTag,
  markRecoverableProcessError,
  normalizeRemoteIoProcessError,
};
