import StorageProvider from './base.js';
import { createStoragePutResult, createStorageReadResultFromResponse } from './contract.js';
import { normalizeRemoteIoProcessError } from '../bootstrap/entry-error-policy.js';
import { toBuffer } from '../utils/storage-io.js';
import { wrapTestConnection } from './storage-error-helper.js';
import { fetchWithProxy } from '../network/proxy.js';

function trimSlashes(value) {
  return String(value || '').replace(/^\/+|\/+$/g, '');
}

function joinPath(...parts) {
  return parts
    .map((part) => trimSlashes(part))
    .filter(Boolean)
    .join('/');
}

function encodePathSegment(segment) {
  return encodeURIComponent(segment).replace(/%2F/gi, '/');
}

function encodeWebDavPath(pathValue) {
  return String(pathValue || '')
    .split('/')
    .filter(Boolean)
    .map(encodePathSegment)
    .join('/');
}

function normalizeEndpoint(endpoint) {
  const value = String(endpoint || '').trim();
  if (!value) {
    throw new Error('[WebDAVStorage] 缺少 endpoint');
  }

  return value.replace(/\/+$/g, '');
}

function createBasicAuth(username, password) {
  const user = String(username || '');
  const pass = String(password || '');
  return `Basic ${Buffer.from(`${user}:${pass}`, 'utf8').toString('base64')}`;
}

class WebDAVStorage extends StorageProvider {
  constructor(config = {}) {
    super();
    this.endpoint = normalizeEndpoint(config.endpoint);
    this.username = config.username || '';
    this.password = config.password || '';
    this.pathPrefix = trimSlashes(config.pathPrefix || '');
    this.publicUrl = config.publicUrl ? String(config.publicUrl).replace(/\/+$/g, '') : '';
    this.proxyUrl = config.proxyUrl || '';
  }

  _buildHeaders(extraHeaders = {}) {
    const headers = { ...extraHeaders };
    if (this.username || this.password) {
      headers.Authorization = createBasicAuth(this.username, this.password);
    }
    return headers;
  }

  _resolveStorageKey(fileName) {
    if (!fileName) {
      throw new Error('[WebDAVStorage] 缺少 fileName');
    }
    return joinPath(this.pathPrefix, fileName);
  }

  _buildUrl(storageKey) {
    const encodedPath = encodeWebDavPath(storageKey);
    return encodedPath ? `${this.endpoint}/${encodedPath}` : this.endpoint;
  }

  async _request(storageKey, options = {}, source = 'request') {
    try {
      return await fetchWithProxy(
        this._buildUrl(storageKey),
        {
          ...options,
          headers: this._buildHeaders(options.headers || {}),
        },
        this.proxyUrl
      );
    } catch (error) {
      throw normalizeRemoteIoProcessError(error, {
        source: `storage:webdav:${source}`,
      });
    }
  }

  async _ensureDirectories(storageKey, signal = null) {
    const segments = String(storageKey || '').split('/').filter(Boolean);
    if (segments.length <= 1) {
      return;
    }

    const directories = segments.slice(0, -1);
    let currentPath = '';
    for (const directory of directories) {
      currentPath = joinPath(currentPath, directory);
      const response = await this._request(currentPath, {
        method: 'MKCOL',
        signal: signal || undefined,
      }, 'mkcol');

      if (response.ok || response.status === 405) {
        continue;
      }

      throw new Error(`[WebDAVStorage] 创建目录失败: ${currentPath} (${response.status} ${response.statusText})`);
    }
  }

  async put(file, options = {}) {
    const { fileName, mimeType, signal } = options;
    const storageKey = this._resolveStorageKey(fileName);
    const buffer = await toBuffer(file, { signal: signal || null });

    await this._ensureDirectories(storageKey, signal || null);

    const response = await this._request(storageKey, {
      method: 'PUT',
      headers: {
        'Content-Type': mimeType || 'application/octet-stream',
        'Content-Length': String(buffer.length),
      },
      body: buffer,
      signal: signal || undefined,
    }, 'put');

    if (!response.ok) {
      throw new Error(`[WebDAVStorage] 上传失败: ${response.status} ${response.statusText}`);
    }

    return createStoragePutResult({
      storageKey,
      size: buffer.length,
    });
  }

  async getStreamResponse(storageKey, options = {}) {
    const headers = {};
    if (options.start !== undefined && options.end !== undefined) {
      headers.Range = `bytes=${options.start}-${options.end}`;
    }

    const response = await this._request(storageKey, {
      method: 'GET',
      headers,
      signal: options.signal || undefined,
    }, 'get');

    if (!response.ok) {
      throw new Error(`[WebDAVStorage] 读取失败: ${response.status} ${response.statusText}`);
    }

    return createStorageReadResultFromResponse(response);
  }

  async getUrl(storageKey) {
    if (this.publicUrl) {
      const encodedPath = encodeWebDavPath(storageKey);
      return encodedPath ? `${this.publicUrl}/${encodedPath}` : this.publicUrl;
    }

    return `webdav://${storageKey}`;
  }

  async delete(storageKey, options = {}) {
    try {
      const response = await this._request(storageKey, {
        method: 'DELETE',
        signal: options?.signal || undefined,
      }, 'delete');
      return response.ok || response.status === 404;
    } catch {
      return false;
    }
  }

  async exists(storageKey) {
    const response = await this._request(storageKey, {
      method: 'HEAD',
    }, 'exists');
    if (response.ok) {
      return true;
    }
    if (response.status === 404) {
      return false;
    }
    throw new Error(`[WebDAVStorage] 检查文件失败: ${response.status} ${response.statusText}`);
  }

  async testConnection() {
    return wrapTestConnection(async () => {
      const targetPath = this.pathPrefix || '';
      if (targetPath) {
        await this._ensureDirectories(joinPath(targetPath, '.imgbed-connection-test'), AbortSignal.timeout(10000));
      }

      const response = await this._request(targetPath, {
        method: 'HEAD',
        signal: AbortSignal.timeout(10000),
      }, 'testConnection');

      if (response.ok || response.status === 405) {
        return { ok: true, message: 'WebDAV 连接成功' };
      }

      const error = new Error(response.statusText || '连接失败');
      error.status = response.status;
      throw error;
    }, { source: 'webdav' });
  }

  getChunkConfig() {
    return {
      enabled: true,
      chunkThreshold: 100 * 1024 * 1024,
      chunkSize: 50 * 1024 * 1024,
      maxChunks: 1000,
      mode: 'generic',
    };
  }

  async putChunk(chunkBuffer, options = {}) {
    const { fileId, chunkIndex, mimeType, signal } = options;
    const chunkName = `chunks/${fileId}/chunk_${String(chunkIndex).padStart(4, '0')}`;
    return this.put(chunkBuffer, {
      fileName: chunkName,
      mimeType: mimeType || 'application/octet-stream',
      signal: signal || null,
    });
  }
}

export default WebDAVStorage;
export {
  createBasicAuth,
  encodeWebDavPath,
  joinPath,
};
