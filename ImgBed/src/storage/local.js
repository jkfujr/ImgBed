import fs from 'fs';
import path from 'path';
import { pipeline } from 'stream/promises';

import { resolveAppPath } from '../config/app-root.js';
import { createLogger } from '../utils/logger.js';
import StorageProvider from './base.js';

const log = createLogger('local');

class LocalStorage extends StorageProvider {
  constructor(config) {
    super();
    this.basePath = resolveAppPath(config.basePath || './data/storage');

    if (!fs.existsSync(this.basePath)) {
      fs.mkdirSync(this.basePath, { recursive: true });
    }
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
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    if (file instanceof Buffer) {
      await fs.promises.writeFile(filePath, file);
    } else if (file instanceof fs.ReadStream || file.stream) {
      const stream = typeof file.stream === 'function' ? file.stream() : file;
      const writeStream = fs.createWriteStream(filePath);
      await pipeline(stream, writeStream);
    } else if (typeof file.arrayBuffer === 'function') {
      const buf = Buffer.from(await file.arrayBuffer());
      await fs.promises.writeFile(filePath, buf);
    } else {
      throw new Error('不支持的上传文件对象格式');
    }

    return {
      id,
      path: filePath,
    };
  }

  async getStream(id, options = {}) {
    const filePath = this._getPhysicalPath(id);
    if (!fs.existsSync(filePath)) {
      throw new Error(`文件不存在: ${id}`);
    }

    const { start, end } = options;
    const readOptions = {};
    if (start !== undefined && end !== undefined) {
      readOptions.start = start;
      readOptions.end = end;
    }

    return fs.createReadStream(filePath, readOptions);
  }

  async getUrl(id) {
    return `local://${id}`;
  }

  async delete(id) {
    const filePath = this._getPhysicalPath(id);
    try {
      if (fs.existsSync(filePath)) {
        await fs.promises.unlink(filePath);
      }
      return true;
    } catch (err) {
      log.error({ err }, '删除文件失败');
      return false;
    }
  }

  async exists(id) {
    const filePath = this._getPhysicalPath(id);
    return fs.existsSync(filePath);
  }

  async testConnection() {
    try {
      if (!fs.existsSync(this.basePath)) {
        return { ok: false, message: `目录不存在: ${this.basePath}` };
      }

      await fs.promises.access(this.basePath, fs.constants.W_OK);
      return { ok: true, message: `目录可写: ${this.basePath}` };
    } catch (err) {
      return { ok: false, message: `目录不可写: ${err.message}` };
    }
  }
}

export default LocalStorage;
