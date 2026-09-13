# Portico

A governed portal for agents.

Agent 不在这里运行。  
Agent 在这里被发布、发现、授权和访问。

Portico 是组织的门廊：CLI、MCP、Web 都是入口，内部 / 公开 / 审批 / 分级权限是治理。日常维护委派给 Agent，人类只做安全审计。

## 文档

- 项目画像、功能清单与方向：[`docs/roadmap.md`](docs/roadmap.md)
- Agent 工作规范：[`AGENTS.md`](AGENTS.md)

## 质量与验收

一级业务功能必须达到 [`docs/roadmap.md`](docs/roadmap.md) 验收矩阵的覆盖底线：Happy Path E2E、高风险失败路径、权限双角色、写操作失败恢复；新增一级功能必须同步补 E2E 并更新矩阵。
