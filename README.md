# 午夜书斋 / ChatFiles

把一台电脑里**你自己**的微信（+ QQ）聊天记录与文件，解密、解析、AI 提炼，做成一个本地可浏览的「第二大脑」网站。

> 纯本地运行，不上传任何数据。

## 功能概览

| 板块 | 功能 |
|------|------|
| **概览** | 总量仪表盘（会话/消息/联系人/文件/洞察） |
| **聊天** | 全部微信会话按人/群浏览，真实气泡 UI |
| **文件** | VS Code 风格文件树 + 多格式内部渲染 |
| **洞察** | AI 提炼要点 + 主题富文本总结 |
| **学业** | 课程/资料板块 |

## 技术栈

- React 19 + TypeScript + Vite 8
- Express 5 + `node:sqlite`
- Node 24（内置 zstd）
- 午夜书斋设计系统（深色编辑风）

## 快速开始

```bash
npm install
npm run build
npm start        # → http://127.0.0.1:3456
```

## 复刻指南

完整的复刻文档包在 [`replication/`](./replication/) 目录下：

| 文档 | 内容 |
|------|------|
| [`00_README.md`](replication/00_README.md) | 导航 + 安全红线 |
| [`01_PROMPT.md`](replication/01_PROMPT.md) | 可直接使用的复刻提示词 |
| [`02_SPEC.md`](replication/02_SPEC.md) | **完整技术规格**（核心文档） |
| [`03_SKILLS.md`](replication/03_SKILLS.md) | 用到的 skills 与方法论 |
| [`04_RUNBOOK.md`](replication/04_RUNBOOK.md) | 逐步操作手册 |

## 架构约束

- **单文件不超过 300 行**：按职责拆分
- **只读原始数据**：绝不删除/移动/改写任何原始聊天记录
- **纯本地**：不上传任何数据到外部服务

## 许可

仅供个人学习与数据归档使用。
