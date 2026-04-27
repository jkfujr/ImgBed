import assert from 'node:assert/strict';
import test from 'node:test';

import {
  LOGIN_TABS,
  resolveLoginViewState,
} from '../../../ImgBed-web/src/auth/login-page-state.js';

test('登录页在访客上传关闭时隐藏访客密码分页并进入管理员登录', () => {
  assert.deepEqual(resolveLoginViewState({
    requestedTab: LOGIN_TABS.GUEST,
    guestUploadConfig: {
      guestUploadEnabled: false,
      requirePassword: false,
    },
  }), {
    guestPasswordTabVisible: false,
    tabValue: LOGIN_TABS.ADMIN,
  });
});

test('登录页在访客上传无需密码时隐藏访客密码分页', () => {
  assert.deepEqual(resolveLoginViewState({
    requestedTab: LOGIN_TABS.GUEST,
    guestUploadConfig: {
      guestUploadEnabled: true,
      requirePassword: false,
    },
  }), {
    guestPasswordTabVisible: false,
    tabValue: LOGIN_TABS.ADMIN,
  });
});

test('登录页在访客上传需要密码时允许默认进入访客密码页', () => {
  assert.deepEqual(resolveLoginViewState({
    requestedTab: LOGIN_TABS.GUEST,
    guestUploadConfig: {
      guestUploadEnabled: true,
      requirePassword: true,
    },
  }), {
    guestPasswordTabVisible: true,
    tabValue: LOGIN_TABS.GUEST,
  });

  assert.deepEqual(resolveLoginViewState({
    requestedTab: LOGIN_TABS.ADMIN,
    guestUploadConfig: {
      guestUploadEnabled: true,
      requirePassword: true,
    },
  }), {
    guestPasswordTabVisible: true,
    tabValue: LOGIN_TABS.ADMIN,
  });
});

test('登录页在访客配置不可用时按管理员登录处理', () => {
  assert.deepEqual(resolveLoginViewState({
    requestedTab: LOGIN_TABS.GUEST,
    guestUploadConfig: null,
  }), {
    guestPasswordTabVisible: false,
    tabValue: LOGIN_TABS.ADMIN,
  });
});
