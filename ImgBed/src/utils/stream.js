import { toBuffer } from './storage-io.js';

/**
 * 兼容旧调用名，统一委托到新的二进制输入工具。
 * @param {Buffer|import('stream').Readable|ReadableStream|Blob|File|ArrayBuffer|Uint8Array} stream
 * @returns {Promise<Buffer>}
 */
export async function streamToBuffer(stream) {
  return toBuffer(stream);
}
