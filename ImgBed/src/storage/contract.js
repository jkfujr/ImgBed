function toFiniteNumber(value) {
  if (value === null || value === undefined || value === '') {
    return null;
  }

  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

function normalizeStatusCode(statusCode) {
  if (statusCode === 200 || statusCode === 206) {
    return statusCode;
  }
  return null;
}

function parseContentRange(contentRange) {
  if (!contentRange) {
    return null;
  }

  const match = /^bytes\s+(\d+)-(\d+)\/(\d+)$/i.exec(String(contentRange).trim());
  if (!match) {
    return null;
  }

  return {
    start: Number(match[1]),
    end: Number(match[2]),
    totalSize: Number(match[3]),
  };
}

function createStorageReadResult({
  stream,
  contentLength = null,
  totalSize = null,
  statusCode = null,
  acceptRanges = false,
} = {}) {
  return {
    stream,
    contentLength: toFiniteNumber(contentLength),
    totalSize: toFiniteNumber(totalSize),
    statusCode: normalizeStatusCode(statusCode),
    acceptRanges: Boolean(acceptRanges),
  };
}

function createStorageReadResultFromResponse(response) {
  const contentRange = parseContentRange(response.headers.get('content-range'));
  const contentLength = response.headers.get('content-length');
  const acceptRanges = response.headers.get('accept-ranges') === 'bytes' || response.status === 206;

  return createStorageReadResult({
    stream: response.body,
    contentLength,
    totalSize: contentRange?.totalSize ?? (response.status === 200 ? contentLength : null),
    statusCode: response.status,
    acceptRanges,
  });
}

function createStoragePutResult({
  storageKey,
  size = null,
  deleteToken = null,
} = {}) {
  if (!storageKey) {
    throw new Error('storageKey 不能为空');
  }

  return {
    storageKey: String(storageKey),
    size: toFiniteNumber(size),
    deleteToken: deleteToken && typeof deleteToken === 'object' ? deleteToken : null,
  };
}

function createStorageChunkPutResult({
  storageKey,
  size,
  deleteToken = null,
} = {}) {
  const result = createStoragePutResult({
    storageKey,
    size,
    deleteToken,
  });

  return {
    storageKey: result.storageKey,
    size: result.size ?? 0,
    deleteToken: result.deleteToken,
  };
}

export {
  createStorageChunkPutResult,
  createStoragePutResult,
  createStorageReadResult,
  createStorageReadResultFromResponse,
  parseContentRange,
  toFiniteNumber,
};
