/**
 * ImgBed 测试平台路径配置模块
 * 统一管理所有项目路径
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// 基础路径
export const PATHS = {
  // 测试平台根目录 (ImgBed-test)
  testRoot: path.resolve(__dirname, '..', '..'),

  // 工作区根目录（ImgBed 项目根目录）
  workspaceRoot: path.resolve(__dirname, '..', '..', '..'),

  // 后端项目路径
  backend: {
    root: path.resolve(__dirname, '..', '..', '..', 'ImgBed'),
    src: path.resolve(__dirname, '..', '..', '..', 'ImgBed', 'src'),
    test: path.resolve(__dirname, '..', '..', '..', 'ImgBed', 'test'),
    routes: path.resolve(__dirname, '..', '..', '..', 'ImgBed', 'src', 'routes'),
    services: path.resolve(__dirname, '..', '..', '..', 'ImgBed', 'src', 'services'),
    storage: path.resolve(__dirname, '..', '..', '..', 'ImgBed', 'src', 'storage'),
    database: path.resolve(__dirname, '..', '..', '..', 'ImgBed', 'src', 'database'),
    main: path.resolve(__dirname, '..', '..', '..', 'ImgBed', 'main.js'),
    app: path.resolve(__dirname, '..', '..', '..', 'ImgBed', 'src', 'app.js'),
  },

  // 前端项目路径
  frontend: {
    root: path.resolve(__dirname, '..', '..', '..', 'ImgBed-web'),
    src: path.resolve(__dirname, '..', '..', '..', 'ImgBed-web', 'src'),
    components: path.resolve(__dirname, '..', '..', '..', 'ImgBed-web', 'src', 'components'),
    pages: path.resolve(__dirname, '..', '..', '..', 'ImgBed-web', 'src', 'pages'),
    utils: path.resolve(__dirname, '..', '..', '..', 'ImgBed-web', 'src', 'utils'),
  },

  // 测试平台内部路径
  test: {
    // 后端测试（已迁移到 ImgBed/test）
    backendRoot: path.resolve(__dirname, '..', '..', 'backend'),
    backendRules: path.resolve(__dirname, '..', '..', 'backend', 'rules'),
    backendVerify: path.resolve(__dirname, '..', '..', 'backend', 'verify'),
    backendConfig: path.resolve(__dirname, '..', '..', 'backend', 'config'),
    backendLegacy: path.resolve(__dirname, '..', '..', 'backend', 'legacy'),

    // 共享模块
    shared: path.resolve(__dirname, '..', '..', 'shared'),
    sharedLib: path.resolve(__dirname, '..', '..', 'shared', 'lib'),

    // 报告目录
    reports: path.resolve(__dirname, '..', '..', 'reports'),
    reportsBackend: path.resolve(__dirname, '..', '..', 'reports', 'backend'),
    reportsFrontend: path.resolve(__dirname, '..', '..', 'reports', 'frontend'),
    reportsAll: path.resolve(__dirname, '..', '..', 'reports', 'all'),
  },
};

// 文件扩展名配置
export const EXTENSIONS = {
  backend: ['.js'],
  frontend: ['.js', '.jsx'],
};

// 排除目录配置
export const EXCLUDE_DIRS = {
  common: ['node_modules', 'dist', '.git'],
  backend: ['node_modules', 'dist', '.git', 'data'],
  frontend: ['node_modules', 'dist', '.git'],
};

// 环境变量键名
export const ENV_KEYS = {
  IMGBED_SRC_ROOT: 'IMGBED_SRC_ROOT',
};

/**
 * 获取相对于工作区根目录的相对路径
 * @param {string} absolutePath - 绝对路径
 * @returns {string} 相对路径
 */
export function getRelativePath(absolutePath) {
  return path.relative(PATHS.workspaceRoot, absolutePath);
}

/**
 * 获取相对于测试平台根目录的相对路径
 * @param {string} absolutePath - 绝对路径
 * @returns {string} 相对路径
 */
export function getRelativeToTestRoot(absolutePath) {
  return path.relative(PATHS.testRoot, absolutePath);
}

/**
 * 规范化路径分隔符（统一为正斜杠）
 * @param {string} filePath - 文件路径
 * @returns {string} 规范化后的路径
 */
export function normalizePath(filePath) {
  return filePath.replace(/\\/g, '/');
}

export default PATHS;
