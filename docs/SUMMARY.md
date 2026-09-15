# Summary

- [首页与快速导览](README.md)

# 1. 概览与核心架构
- [什么是 Portico](intro/overview.md)
- [核心架构与信任边界](intro/architecture.md)
- [产品铁律与非目标](intro/iron-rules.md)
- [快速上手指南](intro/quickstart.md)

# 2. 身份与访问控制
- [身份与权限体系概览](access/README.md)
- [信任根与数据存储](access/trust-root.md)
- [角色模型与权限矩阵](access/roles.md)
- [首位人类审计者引导](access/bootstrap.md)
- [凭证签发与登录会话](access/sessions.md)
- [身份注销与凭证作废](access/revocation.md)

# 3. 目录与生命周期治理
- [目录内核与治理模型](catalog/README.md)
- [记录元数据规范 (Schema)](catalog/schema.md)
- [生命周期状态机](catalog/lifecycle.md)
- [内部草稿与发布](catalog/publish.md)
- [受治理的表面更新](catalog/updates.md)
- [公开发布与独立审批](catalog/approval.md)
- [公开发布撤回](catalog/withdrawal.md)

# 4. 渠道与协议入口
- [多渠道治理入口概览](channels/README.md)
- [MCP 渠道与连接信息](channels/mcp.md)
- [Web 渠道与直连发现](channels/web.md)
- [CLI 渠道与包坐标发现](channels/cli.md)
- [MCP 协议服务器 (JSON-RPC)](channels/mcp-server.md)
- [MCP Gateway 鉴权网关](channels/mcp-gateway.md)

# 5. Web 门户与界面设计
- [Web 门户架构概览](portal/README.md)
- [双平面设计哲学](portal/dual-plane.md)
- [内部工作台 (/internal)](portal/internal-workbench.md)
- [公开发布目录 (/public)](portal/public-releases.md)
- [发现主页与详情栏 (/ & /s/:id)](portal/discovery.md)
- [颜色主题系统与无脚本规范](portal/theme-spec.md)
- [受约束的组件盒 (UI Components)](portal/components.md)
- [Portal REST API 接口规范](portal/api.md)

# 6. 审计与安全模型
- [安全治理与审计概览](security/README.md)
- [追加写审计日志体系](security/audit-trail.md)
- [人类安全审计检查清单](security/human-audit.md)
- [防自批与会话防伪机制](security/anti-self-approval.md)
- [零明文密钥引用原则](security/secrets.md)

# 7. 运维与部署
- [运维管理概览](ops/README.md)
- [Supervisor 进程管理 (up)](ops/supervisor.md)
- [独立二进制编译 (build)](ops/build.md)
- [环境变量配置参考](ops/env-vars.md)
- [Systemd 生产服务编排](ops/systemd.md)
- [Deno L0 运行时与权限白名单](ops/runtime-l0.md)

# 8. 参考手册与规范
- [参考手册索引](reference/README.md)
- [CLI 命令行工具完整参考](reference/cli.md)
- [Agent 协作工作规范](reference/agents.md)
- [验收矩阵与质量底线](reference/acceptance-matrix.md)
- [附录 A：项目画像与路线图](roadmap.md)
- [附录 B：UI 设计规范全貌](ui-spec.md)
