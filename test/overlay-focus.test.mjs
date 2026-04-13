import { strict as assert } from 'node:assert';

import {
  blurFocusTrigger,
  canRestoreFocus,
  createOverlayFocusManager,
  resolveFocusTrigger,
  restoreFocusTrigger,
} from '../ImgBed-web/src/utils/overlay-focus.js';

function createMockElement(name) {
  return {
    name,
    blurCalls: 0,
    focusCalls: [],
    isConnected: true,
    disabled: false,
    blur() {
      this.blurCalls += 1;
    },
    focus(options) {
      this.focusCalls.push(options);
    },
    getAttribute() {
      return null;
    },
  };
}

function testResolveFocusTriggerFallsBackToActiveElement() {
  const activeElement = createMockElement('active');
  assert.equal(resolveFocusTrigger(null, activeElement), activeElement);
  console.log('  [OK] overlay-focus: 空触发源会回退到当前焦点元素');
}

function testBlurAndRestoreHelpersIgnoreInvalidTargets() {
  const hiddenElement = createMockElement('hidden');
  hiddenElement.getAttribute = (name) => (name === 'aria-hidden' ? 'true' : null);
  const disabledElement = createMockElement('disabled');
  disabledElement.disabled = true;

  blurFocusTrigger(hiddenElement);
  assert.equal(hiddenElement.blurCalls, 1);
  assert.equal(canRestoreFocus(hiddenElement), false);
  assert.equal(canRestoreFocus(disabledElement), false);
  assert.equal(restoreFocusTrigger(hiddenElement), false);
  console.log('  [OK] overlay-focus: 无效节点不会被错误恢复焦点');
}

function testOpenAndCloseManageTriggerFocus() {
  const trigger = createMockElement('trigger');
  const activeElement = createMockElement('active');
  const manager = createOverlayFocusManager({
    getActiveElement: () => activeElement,
    scheduleFocus: (callback) => callback(),
  });

  let opened = false;
  manager.open(trigger, () => {
    opened = true;
  });
  manager.close(() => {
    opened = false;
  });

  assert.equal(opened, false);
  assert.equal(activeElement.blurCalls, 1, '打开弹层前应先释放当前焦点');
  assert.equal(trigger.blurCalls, 1, '触发按钮应主动失焦');
  assert.equal(trigger.focusCalls.length, 1, '关闭弹层后应恢复触发按钮焦点');
  assert.deepEqual(trigger.focusCalls[0], { preventScroll: true });
  console.log('  [OK] overlay-focus: 打开与关闭会成对处理焦点');
}

function testMenuActionIsDeferredUntilExit() {
  const anchor = createMockElement('menu-anchor');
  const activeElement = createMockElement('menu-item');
  const scheduled = [];
  const events = [];
  const manager = createOverlayFocusManager({
    getActiveElement: () => activeElement,
    scheduleOpen: (callback) => {
      scheduled.push(callback);
    },
  });

  manager.queueMenuAction({
    restoreTarget: anchor,
    closeMenu: () => {
      events.push('close-menu');
    },
    openOverlay: () => {
      events.push('open-dialog');
    },
  });

  assert.deepEqual(events, ['close-menu']);
  assert.equal(manager.hasPendingMenuAction(), true);

  manager.flushPendingMenuAction();
  assert.equal(manager.hasPendingMenuAction(), false);
  assert.equal(scheduled.length, 1, '菜单退出后才应调度下一个弹层');

  scheduled[0]();
  assert.deepEqual(events, ['close-menu', 'open-dialog']);
  assert.equal(anchor.blurCalls, 1);
  assert.equal(activeElement.blurCalls, 1);
  console.log('  [OK] overlay-focus: 菜单链路会延后到退出后再打开下一个弹层');
}

function main() {
  console.log('running overlay-focus tests...');
  testResolveFocusTriggerFallsBackToActiveElement();
  testBlurAndRestoreHelpersIgnoreInvalidTargets();
  testOpenAndCloseManageTriggerFocus();
  testMenuActionIsDeferredUntilExit();
  console.log('overlay-focus tests passed');
}

main();
