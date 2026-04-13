import { strict as assert } from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve('F:/Code/code/0x10_fork/ImgBed');

function read(relPath) {
  return fs.readFileSync(path.join(ROOT, relPath), 'utf8');
}

function testCreateActionButtonUsesDeferredMenuFlow() {
  const source = read('ImgBed-web/src/components/layout/CreateActionButton.jsx');

  assert.match(source, /createOverlayFocusManager/);
  assert.match(source, /queueMenuDialogOpen/);
  assert.match(source, /flushPendingMenuAction/);
  assert.doesNotMatch(source, /handleCreateMenuClose\(\);\s*setPasteDialogOpen\(true\)/);
  assert.doesNotMatch(source, /handleCreateMenuClose\(\);\s*setFolderDialogOpen\(true\)/);
  assert.doesNotMatch(source, /handleCreateMenuClose\(\);\s*setChannelDialogOpen\(true\)/);
  console.log('  [OK] frontend-overlay-focus-static: 顶部新建菜单已改为延后打开弹层');
}

function testSearchAndTokenDialogsUseFocusManager() {
  const layoutSource = read('ImgBed-web/src/layout/MainLayout.jsx');
  const tokenSource = read('ImgBed-web/src/components/admin/ApiTokenPanel.jsx');

  assert.match(layoutSource, /createOverlayFocusManager/);
  assert.match(layoutSource, /handleSearchDialogOpen/);
  assert.match(layoutSource, /searchDialogFocusManager\.close/);
  assert.match(tokenSource, /createDialogFocusManager\.open/);
  assert.match(tokenSource, /deleteDialogFocusManager\.open/);
  console.log('  [OK] frontend-overlay-focus-static: 搜索与 API Token 弹层已接入统一焦点管理');
}

function testAdminHooksAcceptTriggerElements() {
  const filesAdminSource = read('ImgBed-web/src/hooks/useFilesAdmin.js');
  const storageChannelsSource = read('ImgBed-web/src/hooks/useStorageChannels.js');

  assert.match(filesAdminSource, /handleOpenDetail = useCallback\(\(trigger, item\)/);
  assert.match(filesAdminSource, /triggerDelete = useCallback\(\(trigger, ids, label/);
  assert.match(filesAdminSource, /openMigrate = useCallback\(\(trigger\)/);
  assert.match(storageChannelsSource, /const openEdit = \(trigger, storage\)/);
  assert.match(storageChannelsSource, /const openDeleteDialog = \(trigger, target\)/);
  console.log('  [OK] frontend-overlay-focus-static: 页面级弹层入口已改为传递触发元素');
}

function testLegacyCreateMenuNoLongerSynchronouslyChainsCloseAndOpen() {
  const source = read('ImgBed-web/src/components/admin/FilesAdminCreateMenu.jsx');

  assert.doesNotMatch(source, /onClose\(\);\s*action\(\);/);
  assert.match(source, /globalThis\.setTimeout\(\(\) => action\(\), 0\)/);
  console.log('  [OK] frontend-overlay-focus-static: 旧的新建菜单组件也避免了同步串联弹层');
}

function main() {
  console.log('running frontend-overlay-focus-static tests...');
  testCreateActionButtonUsesDeferredMenuFlow();
  testSearchAndTokenDialogsUseFocusManager();
  testAdminHooksAcceptTriggerElements();
  testLegacyCreateMenuNoLongerSynchronouslyChainsCloseAndOpen();
  console.log('frontend-overlay-focus-static tests passed');
}

main();
