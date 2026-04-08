import { Readable } from 'stream';
import ChunkManager from '../../storage/chunk-manager.js';
import { buildStreamHeaders } from './resolve-file-storage.js';
import { createLogger } from '../../utils/logger.js';

const log = createLogger('handle-stream');

const applyHeaders = (res, headers) => {
  // 处理 Headers 对象或普通对象
  if (headers instanceof Headers) {
    headers.forEach((value, key) => {
      if (value !== undefined && value !== null) {
        res.setHeader(key, value);
      }
    });
  } else {
    Object.entries(headers).forEach(([key, value]) => {
      if (value !== undefined && value !== null) {
        res.setHeader(key, value);
      }
    });
  }
};

/**
 * 处理分块文件流
 */
async function handleChunkedStream(fileRecord, res, { start, end, isPartial, storageManager, etag, lastModified }) {
  const chunks = await ChunkManager.getChunks(fileRecord.id);
  if (!chunks || chunks.length === 0) {
    const error = new Error('分块记录缺失，无法重组文件');
    error.status = 500;
    throw error;
  }

  const getStorageFn = (storageId) => storageManager.getStorage(storageId);
  const mergedStream = ChunkManager.createChunkedReadStream(chunks, getStorageFn, {
    start,
    end,
    totalSize: fileRecord.size
  });

  let streamClosed = false;

  // 清理函数
  const cleanup = () => {
    if (mergedStream && !streamClosed) {
      streamClosed = true;
      mergedStream.destroy();
      log.debug({ fileId: fileRecord.id }, '分块流已清理');
    }
  };

  // 监听响应对象错误（客户端连接错误）
  res.on('error', (err) => {
    log.error({ fileId: fileRecord.id, err }, '响应对象错误');
    cleanup();
  });

  // 监听响应关闭（客户端断开连接）
  res.on('close', () => {
    if (!res.writableEnded) {
      log.warn({ fileId: fileRecord.id }, '客户端提前断开连接');
      cleanup();
    }
  });

  // 监听流错误
  mergedStream.on('error', (err) => {
    log.error({ fileId: fileRecord.id, err }, '分块流传输错误');
    cleanup();

    if (!res.headersSent) {
      res.status(500).json({ code: 500, message: '文件读取失败' });
    }
    // 如果响应头已发送，不做任何操作，让连接自然关闭
  });

  // 监听流结束
  mergedStream.on('end', () => {
    streamClosed = true;
    log.debug({ fileId: fileRecord.id }, '分块流传输完成');
  });

  const headers = buildStreamHeaders({
    fileRecord,
    start,
    end,
    isPartial,
    totalSize: fileRecord.size,
    etag,
    lastModified
  });

  applyHeaders(res, headers);
  res.status(isPartial ? 206 : 200);
  mergedStream.pipe(res);
  return res;
}

/**
 * 处理普通文件流
 */
async function handleRegularStream(fileRecord, res, storage, storageKey, { start, end, isPartial, etag, lastModified }) {
  const options = isPartial ? { start, end } : {};
  let fileStream = null;
  let streamClosed = false;

  // 清理函数
  const cleanup = () => {
    if (fileStream && !streamClosed) {
      streamClosed = true;
      fileStream.destroy();
      log.debug({ storageKey }, '文件流已清理');
    }
  };

  try {
    fileStream = await storage.getStream(storageKey, options).catch(e => {
      log.error({ storageKey, err: e }, '拉取真实流出错');
      return null;
    });

    if (!fileStream) {
      const error = new Error('向原点提取文件内容失败，上游节点未响应');
      error.status = 502;
      throw error;
    }

    const headers = buildStreamHeaders({
      fileRecord,
      start,
      end,
      isPartial,
      totalSize: fileRecord.size,
      etag,
      lastModified
    });

    applyHeaders(res, headers);
    res.status(isPartial ? 206 : 200);

    // 监听响应对象错误（客户端连接错误）
    res.on('error', (err) => {
      log.error({ storageKey, err }, '响应对象错误');
      cleanup();
    });

    // 监听响应关闭（客户端断开连接）
    res.on('close', () => {
      if (!res.writableEnded) {
        log.warn({ storageKey }, '客户端提前断开连接');
        cleanup();
      }
    });

    if (fileStream instanceof Readable) {
      // 监听流错误，避免未捕获的异常导致服务崩溃
      fileStream.on('error', (err) => {
        log.error({ storageKey, err }, '文件流传输错误');
        cleanup();

        if (!res.headersSent) {
          res.status(500).json({ code: 500, message: '文件读取失败' });
        }
        // 如果响应头已发送，不做任何操作，让连接自然关闭
      });

      // 监听流结束
      fileStream.on('end', () => {
        streamClosed = true;
        log.debug({ storageKey }, '文件流传输完成');
      });

      fileStream.pipe(res);
      return res;
    }

    const webStream = Readable.fromWeb(fileStream);

    webStream.on('error', (err) => {
      log.error({ storageKey, err }, 'Web 流传输错误');
      cleanup();

      if (!res.headersSent) {
        res.status(500).json({ code: 500, message: '文件读取失败' });
      }
      // 如果响应头已发送，不做任何操作，让连接自然关闭
    });

    webStream.on('end', () => {
      streamClosed = true;
      log.debug({ storageKey }, 'Web 流传输完成');
    });

    webStream.pipe(res);
    return res;
  } catch (err) {
    log.error({ storageKey, err }, '处理文件流失败');
    cleanup();
    throw err;
  }
}

export { handleChunkedStream,
  handleRegularStream, };
