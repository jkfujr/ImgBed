import { createLogger } from '../utils/logger.js';
import { normalizeRemoteIoProcessError } from '../bootstrap/entry-error-policy.js';
import StorageProvider from './base.js';
import { createStorageReadResultFromResponse } from './contract.js';

const log = createLogger('external');

class ExternalStorage extends StorageProvider {
  constructor(config) {
    super();
    this.baseUrl = config.baseUrl;
    if (!this.baseUrl) {
      log.warn('未配置 baseUrl');
    }

    if (this.baseUrl && !this.baseUrl.endsWith('/')) {
      this.baseUrl += '/';
    }
  }

  async put() {
    throw new Error('[ExternalStorage] 此渠道为纯访问映射，不支持新文件上传。');
  }

  async getStreamResponse(fileId, options = {}) {
    const url = await this.getUrl(fileId);
    if (!url) {
      throw new Error('[ExternalStorage] 外部存储路由地址无效');
    }

    const headers = {};
    if (options.start !== undefined && options.end !== undefined) {
      headers.Range = `bytes=${options.start}-${options.end}`;
    }

    let response;
    try {
      response = await fetch(url, { headers });
    } catch (error) {
      throw normalizeRemoteIoProcessError(error, {
        source: 'storage:external:read',
      });
    }

    if (!response.ok) {
      throw new Error(`[ExternalStorage] 请求外部文件失败: ${response.status} ${response.statusText}`);
    }
    return createStorageReadResultFromResponse(response);
  }

  async getUrl(fileId) {
    return this.baseUrl ? `${this.baseUrl}${fileId}` : null;
  }

  async delete() {
    return false;
  }

  async exists(fileId) {
    const url = await this.getUrl(fileId);
    if (!url) return false;

    try {
      const response = await fetch(url, { method: 'HEAD' });
      return response.ok;
    } catch {
      return false;
    }
  }

  async testConnection() {
    if (!this.baseUrl) {
      return { ok: false, message: '未配置 baseUrl' };
    }

    try {
      const response = await fetch(this.baseUrl, {
        method: 'HEAD',
        redirect: 'follow',
        signal: AbortSignal.timeout(10000),
      });

      if (response.ok || response.status === 404) {
        return { ok: true, message: `网络可达: ${this.baseUrl}` };
      }

      return { ok: false, message: `连接失败: ${response.status} ${response.statusText}` };
    } catch (err) {
      return {
        ok: false,
        message: `连接失败: ${err.name === 'TimeoutError' ? '请求超时' : err.message}`,
      };
    }
  }
}

export default ExternalStorage;
