import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

import {
  classifyEntryError,
  markRecoverableProcessError,
} from '../../src/bootstrap/entry-error-policy.js';
import { resolveProjectPath } from '../helpers/runtime-test-helpers.mjs';

test('classifyEntryError 只把显式标记的异常视为可恢复', () => {
  const recoverableError = markRecoverableProcessError(new Error('socket hang up'), {
    category: 'remote_io',
    source: 'network:proxy',
  });

  const recoverableClassification = classifyEntryError(recoverableError, 'uncaughtException');
  const fatalClassification = classifyEntryError(new Error('socket hang up'), 'uncaughtException');

  assert.equal(recoverableClassification.type, 'recoverable');
  assert.equal(recoverableClassification.category, 'remote_io');
  assert.equal(recoverableClassification.source, 'network:proxy');
  assert.equal(fatalClassification.type, 'fatal_uncaught_exception');
});

test('classifyEntryError 会把 EADDRINUSE 归类为启动监听失败', () => {
  const classification = classifyEntryError({ code: 'EADDRINUSE' }, 'listen');

  assert.equal(classification.type, 'startup_address_in_use');
  assert.equal(classification.shouldExit, true);
  assert.equal(classification.exitCode, 1);
});

test('main.js 通过结构化分类模块处理入口错误，不再维护字符串白名单', () => {
  const source = fs.readFileSync(resolveProjectPath('main.js'), 'utf8');

  assert.match(source, /classifyEntryError/);
  assert.doesNotMatch(source, /RECOVERABLE_ERROR_PATTERNS/);
  assert.doesNotMatch(source, /isRecoverableError/);
});
