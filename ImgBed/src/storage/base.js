/**
 * 存储抽象基类。
 * 所有具体存储驱动都需要继承并实现这些接口。
 */
class StorageProvider {
  /**
   * 上传文件。
   * @param {File|Buffer} file
   * @param {Object} options
   * @returns {Promise<Object>}
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
   * 获取文件可读流。
   * @param {string} id
   * @param {Object} options
   * @returns {Promise<ReadableStream|Buffer>}
   */
  async getStream(id, options) { throw new Error('未实现 getStream()'); }

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
   * 上传单个分块。
   * @param {Buffer} chunkBuffer
   * @param {Object} options
   * @returns {Promise<{ storageKey: string, size: number }>}
   */
  async putChunk(chunkBuffer, options) {
    throw new Error('未实现 putChunk()');
  }

  /**
   * 获取分块可读流。
   * @param {string} storageKey
   * @param {Object} options
   * @returns {Promise<ReadableStream|Buffer>}
   */
  async getChunkStream(storageKey, options) {
    return this.getStream(storageKey, options);
  }

  /**
   * 删除分块。
   * @param {string} storageKey
   * @returns {Promise<boolean>}
   */
  async deleteChunk(storageKey) {
    return this.delete(storageKey);
  }
}

export default StorageProvider;
