# AGENTS.md — ChatFiles 复刻约束

本文件适用于 `replication/`。人类显式指令优先；仓库根 `AGENTS.md` 的 UTF-8、原始数据只读、隐私和阶段提交要求同时适用。

## 唯一权威

现行架构、数据关系、字段映射、能力矩阵和激活流程的唯一权威是 [`docs/spec/01_architecture.md`](docs/spec/01_architecture.md)。其他 replication 文档是补充说明，冲突时不得用旧示例覆盖该规范或仓库中的 Zod/SQL 契约。

## 安全红线

- 只处理机主明确授权的本地数据。
- 绝不删除、移动、重命名或改写微信、QQ、附件等原始数据。
- 解密、解析、索引、转码只读取原件并写 staging/副本/生成物。
- 不上传私人聊天、媒体、数据库或 key；AI 上游只在用户明确配置并发起请求时使用。
- 不运行来源不明的二进制，不绕过未授权数据的安全边界。
- 能力不足时写明 missing/unsupported/conditional，不伪造人物、时间、媒体或 ready 状态。

## 工程规则

- React 19 + Vite 8 + Express 5 保持不变。
- 新源码不超过 300 行；route 薄、application 编排、domain 纯规则、infrastructure 负责 IO。
- `shared/contracts` 环境无关；`server`/`pipeline` 禁止导入 `src`。
- UI 使用真实 URL 与 `/api/v1/*`；CLI/MCP/Agent/HTTP 共用 `operationCatalog`。
- 文本一律 UTF-8，中文、emoji 和路径不得损坏。

## PADC 与提交

每个阶段按 Plan → Analyze → Develop → Commit 推进。测试、typecheck、lint、build、UTF-8、隐私和文档一致性通过后，每阶段创建一次本地 commit。私人数据激活与代码提交分离；未经明确要求不 push、不创建 PR。
