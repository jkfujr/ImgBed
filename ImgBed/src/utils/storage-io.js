import { Blob } from 'buffer';
import { Readable } from 'stream';

function isWebReadableStream(value) {
  return value && typeof value.getReader === 'function';
}

function isBlobLike(value) {
  return value instanceof Blob || typeof value?.arrayBuffer === 'function';
}

async function toBuffer(input) {
  if (Buffer.isBuffer(input)) {
    return input;
  }

  if (input instanceof Uint8Array) {
    return Buffer.from(input);
  }

  if (input instanceof ArrayBuffer) {
    return Buffer.from(input);
  }

  if (input instanceof Readable) {
    const chunks = [];
    for await (const chunk of input) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    return Buffer.concat(chunks);
  }

  if (isWebReadableStream(input)) {
    const reader = input.getReader();
    const chunks = [];
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      chunks.push(Buffer.isBuffer(value) ? value : Buffer.from(value));
    }
    return Buffer.concat(chunks);
  }

  if (isBlobLike(input)) {
    return Buffer.from(await input.arrayBuffer());
  }

  throw new Error('不支持的二进制输入类型');
}

function toNodeReadable(input) {
  if (input instanceof Readable) {
    return input;
  }

  if (Buffer.isBuffer(input)) {
    return Readable.from([input]);
  }

  if (isWebReadableStream(input)) {
    return Readable.fromWeb(input);
  }

  if (typeof input?.stream === 'function') {
    return toNodeReadable(input.stream());
  }

  throw new Error('无法转换为 Node.js Readable');
}

function toBlob(input, mimeType = 'application/octet-stream') {
  if (input instanceof Blob) {
    return input;
  }

  if (Buffer.isBuffer(input)) {
    return new Blob([input], { type: mimeType });
  }

  if (input instanceof Uint8Array) {
    return new Blob([input], { type: mimeType });
  }

  if (input instanceof ArrayBuffer) {
    return new Blob([new Uint8Array(input)], { type: mimeType });
  }

  if (isBlobLike(input)) {
    return input;
  }

  throw new Error('当前输入无法直接转换为 Blob');
}

export {
  toBlob,
  toBuffer,
  toNodeReadable,
};
