import StorageProvider from './base.js';
import fs from 'fs';
import path from 'path';
import { pipeline } from 'stream/promises';
import { fileURLToPath } from 'url';
import { createLogger } from '../utils/logger.js';

const log = createLogger('local');

/**
 * Local 存储渠道实现
 */
class LocalStorage extends StorageProvider {
    constructor(config) {
        super();
        this.basePath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../', config.basePath || './data/storage');
        // 确保存储根目录存在
        if (!fs.existsSync(this.basePath)) {
            fs.mkdirSync(this.basePath, { recursive: true });
        }
    }

    /**
     * 生成基于ID的文件物理路径，采用两级目录分发避免单目录爆炸
     * @param {string} id 
     */
    _getPhysicalPath(id) {
        if (!id || id.length < 4) {
             throw new Error("Invalid id for local storage routing");
        }
        const prefix = id.substring(0, 2);
        return path.join(this.basePath, prefix, id);
    }

    async put(file, options) {
        const { id, fileName } = options;
        if (!id) throw new Error('[LocalStorage] Upload requires an explicit File ID');

        const filePath = this._getPhysicalPath(id);
        const dir = path.dirname(filePath);
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }

        if (file instanceof Buffer) {
            await fs.promises.writeFile(filePath, file);
        } else if (file instanceof fs.ReadStream || file.stream) {
            // 如果传入的是可读流或者具备 stream() 方法（如 fetch Response.body / web file）
            const stream = typeof file.stream === 'function' ? file.stream() : file;
            const writeStream = fs.createWriteStream(filePath);
            await pipeline(stream, writeStream);
        } else if (typeof file.arrayBuffer === 'function') {
             // 针对 Web API File对象
             const buf = Buffer.from(await file.arrayBuffer());
             await fs.promises.writeFile(filePath, buf);
        } else {
            throw new Error("[LocalStorage] Unsupported file object format for put");
        }

        return {
            id: id,
            path: filePath
        };
    }

    async getStream(id, options = {}) {
        const filePath = this._getPhysicalPath(id);
        if (!fs.existsSync(filePath)) {
            throw new Error(`[LocalStorage] File not found: ${id}`);
        }
        const { start, end } = options;
        const readOptions = {};
        if (start !== undefined && end !== undefined) {
            readOptions.start = start;
            readOptions.end = end;
        }
        return fs.createReadStream(filePath, readOptions);
    }

    async getUrl(id, options) {
        // 本地存储不支持直接给外接一个物理 URL，需要由我们的 Node.js /api/files/:id 接口去管转返回流
        // 这里返回标识本身
        return `local://${id}`;
    }

    async delete(id, options) {
        const filePath = this._getPhysicalPath(id);
        try {
            if (fs.existsSync(filePath)) {
                await fs.promises.unlink(filePath);
            }
            return true;
        } catch (err) {
            log.error({ err }, 'Failed to delete file');
            return false;
        }
    }

    async exists(id) {
        const filePath = this._getPhysicalPath(id);
        return fs.existsSync(filePath);
    }

    /**
     * 测试连接：检查目录是否存在且可写
     * @returns {Promise<{ok: boolean, message: string}>}
     */
    async testConnection() {
        try {
            // 检查目录是否存在
            if (!fs.existsSync(this.basePath)) {
                return { ok: false, message: `目录不存在: ${this.basePath}` };
            }
            // 检查是否可写
            await fs.promises.access(this.basePath, fs.constants.W_OK);
            return { ok: true, message: `目录可写: ${this.basePath}` };
        } catch (err) {
            return { ok: false, message: `目录不可写: ${err.message}` };
        }
    }
}

export default LocalStorage;
