# Portico 官方文档

欢迎查阅 **Portico** 官方文档。

> **Agent 不在这里运行。**  
> **Agent 在这里被登记、发布、发现、授权和访问。**

---

## 什么是 Portico？

Portico 是组织的 **Agent 治理门户与准入网关**：
- **治理与编目而非运行时**：Portico 坚守门廊定位，不编排 Agent、不执行 MCP 工具、不代发 LLM 模型推理。
- **三位一体治理入口**：通过 **Web Portal**、**CLI** 与 **MCP**（Model Context Protocol）暴露一致的治理状态。
- **双重信任边界**：明确划分**内部可见**与**公开可见**。公开必须经过独立人类安全审计者的两阶段审批，任何入口均不能绕过。
- **Agent 维护与人类安全审计**：日常编目、元数据更新与门户维护委派给维护者 Agent；人类仅作为安全审计者行使公开审批、凭证管理与违规撤回权力。
- **严苛的运行时沙箱 (L0)**：纯 TypeScript + Deno 运行时，默认拒绝所有未显式声明的读写/网络权限，不引入 Node/Bun 依赖。

---

## 文档导航地图

| 板块 | 核心内容 | 重点文档 |
| :--- | :--- | :--- |
| **1. 概览与核心架构** | 设计哲学、系统架构图、产品铁律、快速上手 | [什么是 Portico](intro/overview.md) · [架构与边界](intro/architecture.md) · [铁律与非目标](intro/iron-rules.md) |
| **2. 身份与访问控制** | 本地信任根、RBAC 角色模型、Bootstrap 引导、会话机制、作废回滚 | [身份权限概览](access/README.md) · [首位审计者引导](access/bootstrap.md) · [凭证与会话](access/sessions.md) |
| **3. 目录与生命周期** | Catalog 元数据、5 态生命周期、草稿与发布、受治更新、独立双人审批、公开撤回 | [生命周期状态机](catalog/lifecycle.md) · [受治更新](catalog/updates.md) · [公开发布审批](catalog/approval.md) |
| **4. 渠道与协议入口** | MCP / Web / CLI 渠道连接信息、只读 MCP Server (JSON-RPC)、MCP Gateway 门卫鉴权 | [MCP 渠道](channels/mcp.md) · [MCP 协议服务器](channels/mcp-server.md) · [MCP Gateway](channels/mcp-gateway.md) |
| **5. Web 门户与界面** | 双平面设计（内部笔记台 vs 公开发布页）、杂志风发现主页、无 JS 语义 Token、受约束组件盒 | [双平面设计哲学](portal/dual-plane.md) · [颜色主题规范](portal/theme-spec.md) · [组件盒规范](portal/components.md) |
| **6. 审计与安全模型** | 不可篡改追加写审计日志、人类审计清单、防自批机制、零明文密钥原则 | [追加写审计体系](security/audit-trail.md) · [人类安全审计](security/human-audit.md) · [防自批机制](security/anti-self-approval.md) |
| **7. 运维与部署** | Supervisor 协同退出机制、独立可执行文件构建、环境变量速查、Systemd 服务配置 | [Supervisor 进程管理](ops/supervisor.md) · [二进制编译](ops/build.md) · [环境配置](ops/env-vars.md) |
| **8. 参考手册与规范** | 完整 CLI 命令手册、Agent 行为守则、质量验收矩阵、UI 完整规范 | [CLI 完整参考](reference/cli.md) · [Agent 工作规范](reference/agents.md) · [质量验收矩阵](reference/acceptance-matrix.md) |

---

## 快速起动体验

一条命令起动整套系统（包含 Portal 8788、Gateway 8789、MCP 8790 三个互隔离进程）：

```bash
PORTICO_DATA_DIR=./data deno task up
```

标准输出将返回一行机读 JSON：

```json
{"ok":true,"data":{"dataDir":"./data","portal":{"url":"http://127.0.0.1:8788"},"gateway":{"url":"http://127.0.0.1:8789"},"mcp":{"url":"http://127.0.0.1:8790"}}}
```

阅读 [快速上手指南](intro/quickstart.md) 开始您的首次服务登记与审批流程。
