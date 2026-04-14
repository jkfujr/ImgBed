# ImgBed 后端测试目录说明

本目录按章节逐步重写，不再一次性追求总覆盖率。

## 当前目录结构

- `01-runtime/`
  - 第 01 章对应测试。
  - 当前覆盖启动入口、配置仓库、运行时装配、`app.js` 的真实路由行为。
- `02-database/`
  - 第 02 章对应测试。
  - 当前覆盖 schema 初始化、迁移登记、DAO 读写、容量投影、容量归档与历史清理。
- `03-http/`
  - 第 03 章对应测试。
  - 当前覆盖 HTTP 入口、中间件、错误处理、代理原语，以及部分真实路由装配与权限边界。
- `04-business/`
  - 第 04 章对应测试。
  - 当前覆盖上传选路与故障切换、删除/迁移/批处理、访问流、目录改名、管理员认证与 API Token 创建服务。
- `05-storage/`
  - 第 05 章对应测试。
  - 当前覆盖存储运行时骨架、存储操作生命周期、恢复器、远端重试原语、Telegram/Discord/S3 兼容分支。
- `helpers/`
  - 章节测试共享辅助工具，不直接作为测试执行入口。
  - 当前包含 `runtime-test-helpers.mjs`、`database-test-helpers.mjs`、`isolated-module-test-helpers.mjs`、`storage-test-helpers.mjs`。

## 运行方式

在 `ImgBed/` 目录下执行：

```powershell
npm test
```

当前 `package.json` 中的测试入口为 `node test/run-backend-tests.mjs`，会递归收集全部 `*.test.mjs` 文件。

## 证据规则

- 只记录真实执行结果，不模拟覆盖率，不伪造测试通过数。
- 每一章测试完成后，再回写对应章节文档和 `.docs/后端深度审查总结报告1/08_测试重写进度与覆盖缺口清单.md`。
- 未补到测试的模块，只能写“静态推断”或“待补验证”，不能直接下“死代码”结论。
