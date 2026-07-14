# ChatFiles 文档权威地图

现行架构、字段映射、数据关系、能力矩阵与数据激活流程的唯一权威是：

- [`replication/docs/spec/01_architecture.md`](../replication/docs/spec/01_architecture.md)

其余文档定位：

- `replication/docs`：补充 runbook、背景和分领域说明；不得覆盖唯一权威。
- `docs/local-access.md`：本地 CLI/MCP 访问说明。
- `docs/verification/`：带日期的历史验证记录，不是规范。
- `docs/superpowers/`：历史设计与实施计划，不是现行接口契约。
- `docs/ChatFiles本地更新/`、`docs/本地部署教程/`：旧版迁移材料，仅供背景参考。

代码中的 Zod schema、SQL schema 和自动化 guardrail 是规范的可执行部分。发现文档冲突时，应修正文档并运行 `npm run check:docs`，不能放宽契约或静默兼容错误状态。
