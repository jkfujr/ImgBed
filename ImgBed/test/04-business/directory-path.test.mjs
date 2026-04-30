import assert from 'node:assert/strict';
import test from 'node:test';

import {
  normalizeDirectoryPath,
  parseOptionalDirectoryPath,
} from '../../src/utils/directory-path.js';

test('normalizeDirectoryPath 会保持既有目录路径归一化语义', () => {
  assert.equal(normalizeDirectoryPath('albums/', { maxLength: 20 }), '/albums');
  assert.equal(normalizeDirectoryPath('/', { maxLength: 20 }), '/');
  assert.equal(normalizeDirectoryPath('////', { maxLength: 20 }), '/');
  assert.equal(parseOptionalDirectoryPath(undefined, { maxLength: 20 }), undefined);
});

test('normalizeDirectoryPath 会按默认 4096 字符限制目录路径长度', () => {
  const tooLongPath = `/${'a'.repeat(4096)}`;

  assert.throws(
    () => normalizeDirectoryPath(tooLongPath),
    (error) => {
      assert.equal(error.message, '目录路径长度不能超过 4096 个字符');
      return true;
    },
  );
});

test('normalizeDirectoryPath 支持传入自定义最大长度', () => {
  assert.equal(normalizeDirectoryPath('/abcd', { maxLength: 5 }), '/abcd');

  assert.throws(
    () => normalizeDirectoryPath('/abcde', { maxLength: 5 }),
    (error) => {
      assert.equal(error.message, '目录路径长度不能超过 5 个字符');
      return true;
    },
  );
});

test('normalizeDirectoryPath 使用线性逻辑裁剪尾部斜杠', () => {
  const pathWithManySlashes = `/${'/'.repeat(5000)}a`;

  assert.equal(normalizeDirectoryPath(pathWithManySlashes, { maxLength: 6000 }), `${'/'.repeat(5001)}a`);
});
