import fs from 'fs';
import path from 'path';
import { pipeline } from 'stream/promises';

import { resolveAppPath } from '../config/app-root.js';
import { createLogger } from '../utils/logger.js';
import { toBuffer, toNodeReadable } from '../utils/storage-io.js';
import StorageProvider from './base.js';
import { createStoragePutResult, createStorageReadResult } from './contract.js';

const log = createLogger('local');

class LocalStorage extends StorageProvider {
  constructor(config) {
    super();
    this.basePath = resolveAppPath(config.basePath || './data/storage');
  }

  async _ensureBasePath() {
    await fs.promises.mkdir(this.basePath, { recursive: true });
  }

  async _ensureParentDir(filePath) {
    await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
  }

  _isMissingPathError(error) {
    return error?.code === 'ENOENT';
  }

  _getPhysicalPath(id) {
    if (!id || id.length < 4) {
      throw new Error('本地存储路由的文件标识无效');
    }

    const prefix = id.substring(0, 2);
    return path.join(this.basePath, prefix, id);
  }

  async put(file, options) {
    const { id } = options;
    if (!id) {
      throw new Error('上传必须提供明确的文件 ID');
    }

    const filePath = this._getPhysicalPath(id);
    await this._ensureParentDir(filePath);

    let fileSize = null;

    if (Buffer.isBuffer(file) || file instanceof Uint8Array || file instanceof ArrayBuffer || typeof file?.arrayBuffer === 'function') {
      const buf = await toBuffer(file);
      fileSize = buf.length;
      await fs.promises.writeFile(filePath, buf);
    } else {
      try {
        const writeStream = fs.createWriteStream(filePath);
        await pipeline(toNodeReadable(file), writeStream);
        const stat = await fs.promises.stat(filePath);
        fileSize = stat.size;
      } catch (error) {
        throw new Error('不支持的上传文件对象格式');
      }
    }

    return createStoragePutResult({
      storageKey: id,
      size: fileSize,
    });
  }

  async getStreamResponse(id, options = {}) {
    const filePath = this._getPhysicalPath(id);
    try {
      const stat = await fs.promises.stat(filePath);
      const { start, end } = options;
      const readOptions = {};
      const isPartial = start !== undefined && end !== undefined;

      if (isPartial) {
        readOptions.start = start;
        readOptions.end = end;
      }

      return createStorageReadResult({
        stream: fs.createReadStream(filePath, readOptions),
        contentLength: isPartial ? (end - start + 1) : stat.size,
        totalSize: stat.size,
        statusCode: isPartial ? 206 : 200,
        acceptRanges: true,
      });
    } catch (error) {
      if (this._isMissingPathError(error)) {
        throw new Error(`文件不存在: ${id}`);
      }
      throw error;
    }
  }

  async getUrl(id) {
    return `local://${id}`;
  }

  async delete(id) {
    const filePath = this._getPhysicalPath(id);
    try {
      await fs.promises.unlink(filePath);
      return true;
    } catch (err) {
      if (this._isMissingPathError(err)) {
        return true;
      }
      log.error({ err }, '删除文件失败');
      return false;
    }
  }

  async exists(id) {
    const filePath = this._getPhysicalPath(id);
    try {
      await fs.promises.access(filePath, fs.constants.F_OK);
      return true;
    } catch (error) {
      if (this._isMissingPathError(error)) {
        return false;
      }
      throw error;
    }
  }

  async testConnection() {
    try {
      await this._ensureBasePath();
      await fs.promises.access(this.basePath, fs.constants.W_OK);
      return { ok: true, message: `目录可写: ${this.basePath}` };
    } catch (err) {
      return { ok: false, message: `目录不可写: ${err.message}` };
    }
  }
}

export default LocalStorage;
