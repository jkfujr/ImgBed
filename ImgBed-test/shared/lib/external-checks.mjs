/**
 * 外部静态检查器编排模块
 * 按目标运行外部检查并返回统一结果结构
 */
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

function readPackageJson(rootDir) {
  const packageJsonPath = path.join(rootDir, 'package.json');
  if (!fs.existsSync(packageJsonPath)) {
    return null;
  }
  return JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
}

function buildSkipped(name, reason) {
  return {
    name,
    passed: false,
    exitCode: -1,
    output: '',
    skipped: true,
    skipReason: reason,
  };
}

function runCommand(name, rootDir, command) {
  try {
    const output = execSync(command, {
      cwd: rootDir,
      encoding: 'utf8',
      stdio: 'pipe',
      maxBuffer: 10 * 1024 * 1024,
    });
    return {
      name,
      passed: true,
      exitCode: 0,
      output: output.trim(),
      skipped: false,
    };
  } catch (error) {
    const output = error.stdout || error.stderr || error.message;
    return {
      name,
      passed: false,
      exitCode: error.status || 1,
      output: typeof output === 'string' ? output.trim() : String(output),
      skipped: false,
    };
  }
}

export function runESLint(rootDir, options = {}) {
  const { scriptName = 'lint' } = options;
  const packageJson = readPackageJson(rootDir);
  if (!packageJson) {
    return buildSkipped('ESLint', '未找到 package.json');
  }
  if (!packageJson.scripts || !packageJson.scripts[scriptName]) {
    return buildSkipped('ESLint', `package.json 中未配置 ${scriptName} 脚本`);
  }
  return runCommand('ESLint', rootDir, `npm run ${scriptName}`);
}

export function runTypeScript(rootDir, options = {}) {
  const { scriptNames = ['type-check', 'typecheck'], fallbackCommand = 'npx tsc --noEmit' } = options;
  const packageJson = readPackageJson(rootDir);
  const hasTsConfig = fs.existsSync(path.join(rootDir, 'tsconfig.json'));

  if (packageJson?.scripts) {
    for (const scriptName of scriptNames) {
      if (packageJson.scripts[scriptName]) {
        return runCommand('TypeScript', rootDir, `npm run ${scriptName}`);
      }
    }
  }

  if (!hasTsConfig) {
    return buildSkipped('TypeScript', '未找到 tsconfig.json 或 type-check 脚本');
  }

  return runCommand('TypeScript', rootDir, fallbackCommand);
}

export function runAllExternalChecks({ target, rootDir }) {
  let checks = [];

  if (target === 'frontend') {
    checks = [
      runESLint(rootDir),
      runTypeScript(rootDir),
    ];
  } else if (target === 'backend') {
    checks = [
      runESLint(rootDir),
      runTypeScript(rootDir),
    ];
  } else {
    throw new Error(`不支持的外部检查目标: ${target}`);
  }

  return {
    checks,
    allPassed: checks.every((check) => check.skipped || check.passed),
  };
}
