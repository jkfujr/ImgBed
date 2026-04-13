/**
 * 存储抽象基类。
 * 所有具体存储驱动都需要继承并实现这些接口。
 */
class StorageProvider {
  /**
   * 实现 StorageProvider 统一写入接口。
   * @param {File|Buffer} file
   * @param {Object} options
   * @returns {Promise<{
   *   storageKey: string,
   *   size: number|null,
   *   deleteToken: Record<string, unknown>|null,
   *   raw: Record<string, unknown>|null,
   * }>}
   */
  async put(file, options) { throw new Error('未实现 put()'); }

  /**
   * 获取文件信息。
   * @param {string} id
   * @returns {Promise<Object>}
   */
  async get(id) { throw new Error('未实现 get()'); }

  /**
   * 删除文件。
   * @param {string} id
   * @param {Object} options
   * @returns {Promise<boolean>}
   */
  async delete(id, options) { throw new Error('未实现 delete()'); }

  /**
   * 实现 StorageProvider 统一读取接口。
   * @param {string} id
   * @param {Object} options
   * @returns {Promise<{
   *   stream: ReadableStream|import('stream').Readable,
   *   contentLength: number|null,
   *   totalSize: number|null,
   *   statusCode: 200|206|null,
   *   acceptRanges: boolean,
   * }>}
   */
  async getStreamResponse(id, options) { throw new Error('未实现 getStreamResponse()'); }

  /**
   * 获取文件直链地址。
   * @param {string} id
   * @param {Object} options
   * @returns {Promise<string>}
   */
  async getUrl(id, options) { throw new Error('未实现 getUrl()'); }

  /**
   * 检查文件是否存在。
   * @param {string} id
   * @returns {Promise<boolean>}
   */
  async exists(id) { throw new Error('未实现 exists()'); }

  /**
   * 测试连接。
   * @returns {Promise<{ok: boolean, message: string}>}
   */
  async testConnection() {
    throw new Error('该存储类型不支持连接测试');
  }

  /**
   * 获取分块配置。
   * @returns {{ enabled: boolean, chunkThreshold: number, chunkSize: number, maxChunks: number, mode: 'generic'|'native' }}
   */
  getChunkConfig() {
    return { enabled: false, chunkThreshold: Infinity, chunkSize: 0, maxChunks: 0, mode: 'generic' };
  }

  /**
   * 实现 StorageProvider 统一分块写入接口。
   * @param {Buffer} chunkBuffer
   * @param {Object} options
   * @returns {Promise<{
   *   storageKey: string,
   *   size: number,
   *   deleteToken: Record<string, unknown>|null,
   *   raw: Record<string, unknown>|null,
   * }>}
   */
  async putChunk(chunkBuffer, options) {
    throw new Error('未实现 putChunk()');
  }

  /**
   * 实现 StorageProvider 统一分块读取接口。
   * @param {string} storageKey
   * @param {Object} options
   * @returns {Promise<{
   *   stream: ReadableStream|import('stream').Readable,
   *   contentLength: number|null,
   *   totalSize: number|null,
   *   statusCode: 200|206|null,
   *   acceptRanges: boolean,
   * }>}
   */
  async getChunkStreamResponse(storageKey, options) {
    return this.getStreamResponse(storageKey, options);
  }

  /**
   * 删除分块。
   * @param {string} storageKey
   * @param {Object} options
   * @returns {Promise<boolean>}
   */
  async deleteChunk(storageKey, options) {
    return this.delete(storageKey, options);
  }
}

export default StorageProvider;
