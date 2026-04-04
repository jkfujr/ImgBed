/**
 * 外部静态检查器编排模块
 * 负责运行 ESLint / TypeScript 等外部工具并返回统一结果结构
 */
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

/**
 * 运行 ESLint 检查
 * @param {string} rootDir 项目根目录
 * @returns {{ name: string, passed: boolean, exitCode: number, output: string, skipped: boolean, skipReason?: string }}
 */
export function runESLint(rootDir) {
  const packageJsonPath = path.join(rootDir, 'package.json');

  // 检查 package.json 是否存在 lint 脚本
  if (!fs.existsSync(packageJsonPath)) {
    return {
      name: 'ESLint',
      passed: false,
      exitCode: -1,
      output: '',
      skipped: true,
      skipReason: '未找到 package.json',
    };
  }

  const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
  if (!packageJson.scripts || !packageJson.scripts.lint) {
    return {
      name: 'ESLint',
      passed: false,
      exitCode: -1,
      output: '',
      skipped: true,
      skipReason: 'package.json 中未配置 lint 脚本',
    };
  }

  // 执行 npm run lint
  try {
    const output = execSync('npm run lint', {
      cwd: rootDir,
      encoding: 'utf8',
      stdio: 'pipe',
      maxBuffer: 10 * 1024 * 1024, // 10MB buffer
    });
    return {
      name: 'ESLint',
      passed: true,
      exitCode: 0,
      output: output.trim(),
      skipped: false,
    };
  } catch (error) {
    // ESLint 失败时会抛出异常
    const output = error.stdout || error.stderr || error.message;
    return {
      name: 'ESLint',
      passed: false,
      exitCode: error.status || 1,
      output: typeof output === 'string' ? output.trim() : String(output),
      skipped: false,
    };
  }
}

/**
 * 运行 TypeScript 检查
 * @param {string} rootDir 项目根目录
 * @returns {{ name: string, passed: boolean, exitCode: number, output: string, skipped: boolean, skipReason?: string }}
 */
export function runTypeScript(rootDir) {
  const packageJsonPath = path.join(rootDir, 'package.json');

  // 检查 typescript 依赖
  let hasTypeScript = false;
  if (fs.existsSync(packageJsonPath)) {
    const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
    hasTypeScript = !!(
      (packageJson.dependencies && packageJson.dependencies.typescript) ||
      (packageJson.devDependencies && packageJson.devDependencies.typescript)
    );
  }

  // 检查 tsconfig.json
  const hasTsConfig = fs.existsSync(path.join(rootDir, 'tsconfig.json'));

  // 检查是否有 tsc 相关脚本
  let hasTscScript = false;
  if (fs.existsSync(packageJsonPath)) {
    const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
    if (packageJson.scripts) {
      hasTscScript = Object.values(packageJson.scripts).some(script =>
        typeof script === 'string' && script.includes('tsc')
      );
    }
  }

  // 如果缺少任一必要条件，跳过检查
  if (!hasTypeScript || !hasTsConfig) {
    const reasons = [];
    if (!hasTypeScript) reasons.push('未安装 typescript 依赖');
    if (!hasTsConfig) reasons.push('未找到 tsconfig.json');

    return {
      name: 'TypeScript',
      passed: false,
      exitCode: -1,
      output: '',
      skipped: true,
      skipReason: reasons.join('、'),
    };
  }

  // 尝试运行 tsc --noEmit
  try {
    const output = execSync('npx tsc --noEmit', {
      cwd: rootDir,
      encoding: 'utf8',
      stdio: 'pipe',
    });
    return {
      name: 'TypeScript',
      passed: true,
      exitCode: 0,
      output: output.trim(),
      skipped: false,
    };
  } catch (error) {
    return {
      name: 'TypeScript',
      passed: false,
      exitCode: error.status || 1,
      output: (error.stdout || error.stderr || error.message).trim(),
      skipped: false,
    };
  }
}

/**
 * 运行所有外部静态检查
 * @param {string} rootDir 项目根目录
 * @returns {{ checks: Array, allPassed: boolean }}
 */
export function runAllExternalChecks(rootDir) {
  const checks = [
    runESLint(rootDir),
    runTypeScript(rootDir),
  ];

  const allPassed = checks.every(check => check.skipped || check.passed);

  return { checks, allPassed };
}
