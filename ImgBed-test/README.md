# ImgBed 测试平台

统一的代码质量检测和测试平台，支持前端和后端的静态分析、结构验证和单元测试。

## 快速开始

```bash
# 运行后端所有检测
node ImgBed-test/run.mjs backend

# 运行前端所有检测
node ImgBed-test/run.mjs frontend

# 运行所有检测
node ImgBed-test/run.mjs all

# 运行后端检测 + 结构验证
node ImgBed-test/run.mjs backend --verify
```

## 检测内容

### Backend 后端检测

1. **静态代码分析** (8 条规则)
   - 架构规则：路由挂载、权限保护、配置写回
   - 复杂度规则：文件行数、路由数量、路由复杂度
   - 性能规则：同步文件操作检测

2. **结构验证** (3 组检查)
   - 启动入口保留数据库初始化
   - 应用保留核心路由挂载
   - 系统配置路由保留敏感保护

3. **单元测试** (13 个测试文件)
   - 语法验证测试
   - 系统配置和服务测试
   - 路由层服务测试
   - 文件和上传服务测试

### Frontend 前端检测

1. **静态代码分析**
   - Bug 检测
   - 复杂度检测
   - 样式规范
   - 架构规范
   - 性能优化
   - 未使用代码

2. **结构验证**
   - 组件拆分验证
   - 架构规范验证

## 命令参数

```bash
node ImgBed-test/run.mjs [target] [options]

Target:
  frontend          运行前端检测
  backend           运行后端检测
  all               运行所有检测（默认）

Options:
  --help, -h        显示帮助信息
  --verify          同时运行结构验证脚本
  --format=json     输出 JSON 格式（默认 text）
  --no-color        禁用彩色输出
  --exit-on-error   有错误时返回非零退出码
  --list-rules      列出可用规则
  --fix             自动修复（仅 frontend）
  --dry-run         预览修复不写入（搭配 --fix）
```

## 示例

### 1. 开发时快速检测

```bash
# 只运行后端静态分析
node ImgBed-test/run.mjs backend

# 只运行前端静态分析
node ImgBed-test/run.mjs frontend
```

### 2. 提交前完整检测

```bash
# 运行后端所有检测（静态分析 + 结构验证 + 单元测试）
node ImgBed-test/run.mjs backend --verify

# 运行所有检测
node ImgBed-test/run.mjs all --verify
```

### 3. CI/CD 集成

```bash
# 有错误时退出码非零
node ImgBed-test/run.mjs all --verify --exit-on-error
```

### 4. 自动修复

```bash
# 预览修复
node ImgBed-test/run.mjs frontend --fix --dry-run

# 应用修复
node ImgBed-test/run.mjs frontend --fix
```

## 输出示例

### 文本格式（默认）

```
# 执行目标: backend
============================================================

╔════════════════════════════════════════════════════════════════════╗
║                  ImgBed backend 代码检测报告                        ║
╚════════════════════════════════════════════════════════════════════╝
  扫描时间: 2026/4/5 03:12:28  |  规则数: 8  |  文件数: 56

  ✓ 检测完成：未发现任何问题。

backend 外部静态检查
============================================================
  ⊘ ESLint: 已跳过
  ⊘ TypeScript: 已跳过
============================================================

backend 单元测试
============================================================
  ✓ verify-syntax.test.mjs (602ms)
  ✓ system-config-fields.test.js (185ms)
  ...
------------------------------------------------------------
总计: 13 个测试文件
通过: 13 个
失败: 0 个
总耗时: 3171ms
通过率: 100.0%
============================================================
```

### JSON 格式

```bash
node ImgBed-test/run.mjs backend --format=json
```

```json
[
  {
    "target": "backend",
    "summary": {
      "totalFiles": 56,
      "totalIssues": 0,
      "errorCount": 0,
      "warningCount": 0
    },
    "externalChecks": {
      "allPassed": true,
      "checks": [...]
    },
    "unitTests": {
      "total": 13,
      "passed": 13,
      "failed": 0,
      "passRate": "100.0",
      "allPassed": true
    },
    "reports": {
      "reportPath": "...",
      "latestPath": "..."
    }
  }
]
```

## 报告文件

所有检测报告保存在 `ImgBed-test/reports/` 目录：

```
ImgBed-test/reports/
├── frontend/
│   ├── report-2026-04-04T19-12-28.md
│   └── report-latest.md
├── backend/
│   ├── report-2026-04-04T19-12-28.md
│   └── report-latest.md
└── all/
    ├── report-2026-04-04T19-12-28.md
    └── report-latest.md
```

## 独立运行单元测试

如果只需要运行后端单元测试：

```bash
# 方式 1: 通过测试平台
node ImgBed-test/backend/tests/run-backend-tests.mjs

# 方式 2: 原有方式（在 ImgBed 目录下）
cd ImgBed
node test/run-all-tests.mjs
```

## 规则列表

查看所有可用规则：

```bash
node ImgBed-test/run.mjs --list-rules
```

## 目录结构

```
ImgBed-test/
├── backend/
│   ├── rules/          # 后端静态分析规则
│   ├── verify/         # 后端结构验证
│   └── tests/          # 后端单元测试
├── frontend/
│   ├── rules/          # 前端静态分析规则
│   ├── verify/         # 前端结构验证
│   └── config/         # 前端规则配置
├── shared/
│   └── lib/            # 共享工具库
├── reports/            # 检测报告输出目录
└── run.mjs             # 统一入口
```

## 技术栈

- Node.js 原生 test runner
- 静态代码分析（AST 解析）
- 规则引擎系统
- 自动修复引擎（frontend）

## 相关文档

- [后端测试整合报告](./backend-test-integration-report.md)
- [语法错误修复报告](./syntax-fix-report.md)
- [最终优化报告](./final-optimization-report.md)

---

**维护**: ImgBed 开发团队  
**更新时间**: 2026/4/5
