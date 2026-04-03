import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const rootDir = path.resolve(process.cwd(), 'ImgBed', 'ImgBed-web', 'src');
const dashboardPath = path.join(rootDir, 'pages', 'admin', 'AdminDashboard.jsx');
const sidebarPath = path.join(rootDir, 'components', 'admin', 'AdminSidebar.jsx');

function readText(filePath) {
  return fs.readFileSync(filePath, 'utf8');
}

function expectAbsent(content, pattern, message) {
  if (pattern.test(content)) {
    throw new Error(message);
  }
}

function expectPresent(content, pattern, message) {
  if (!pattern.test(content)) {
    throw new Error(message);
  }
}

function run() {
  const dashboard = readText(dashboardPath);
  const sidebar = readText(sidebarPath);

  expectPresent(dashboard, /<AdminSidebar/, 'AdminDashboard.jsx 应渲染 AdminSidebar');
  expectPresent(dashboard, /<Outlet\s*\/>/, 'AdminDashboard.jsx 应继续保留 Outlet');
  expectAbsent(dashboard, /<Drawer/, 'AdminDashboard.jsx 不应再直接渲染 Drawer');
  expectAbsent(dashboard, /menuItems/, 'AdminDashboard.jsx 不应再直接维护 menuItems');
  expectAbsent(dashboard, /FolderIcon|StorageIcon|SettingsIcon/, 'AdminDashboard.jsx 不应再直接维护侧边栏图标');

  expectPresent(sidebar, /export const ADMIN_MENU_ITEMS/, 'AdminSidebar.jsx 应维护侧边栏菜单配置');
  expectPresent(sidebar, /<Drawer/, 'AdminSidebar.jsx 应承接 Drawer 渲染');
  expectPresent(sidebar, /onToggleCollapse/, 'AdminSidebar.jsx 应暴露折叠切换入口');
  expectPresent(sidebar, /onNavigate/, 'AdminSidebar.jsx 应通过回调处理跳转');

  console.log('验证通过：AdminDashboard 侧边栏已完成拆分。');
}

run();
