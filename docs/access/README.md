# 身份与访问控制概览

Portico 的访问控制（Access Control）系统旨在为**人与 Agent 共存的组织环境**提供严密、透明且防篡改的鉴权体系。

---

## 核心设计理念

1. **真实证明，拒绝自称**：
   系统严禁信任客户端自定义的请求头（如 `X-Portico-Actor-*` 或 CLI 参数 `--actor-*`）。CLI、Gateway 与 MCP 必须出示经由服务端校验的**登录会话（Session）**。Portal 在显式启用时可把已校验的 Cloudflare Access JWT 映射到名册人类身份，这不是会话，也不会写入 `sessions.json`。
2. **零明文密码与密钥**：
   所有凭证（Credentials）在下发后服务端仅保存加盐后的 SHA-256 哈希值。即便数据文件遭读取，攻击者也无法复原凭证或伪造未授权会话。
3. **不可逾越的角色边界**：
   区分人类（Human）与智能体（Agent）。关键安全治理动作（包括审批公开、作废凭证、吊销主体）被硬性限制为仅限人类审计者执行，智能体维护者绝对无法越权。人类身份可绑定唯一 email，只作名册映射，不能代替会话，也不能赋给 Agent。

---

## 章节导览

- [信任根与数据存储](trust-root.md)：深入理解底层存储文件（`identities.json` 与 `sessions.json`）的原子写入与文件级安全。
- [角色模型与权限矩阵](roles.md)：详解 `auditor`、`maintainer` 与 `reader` 的权限差异，以及主体类型（`human` vs `agent`）的刚性约束。
- [首位人类审计者引导](bootstrap.md)：解析安全 Bootstrap 机制如何实现无需硬编码管理员密码的初始入驻。
- [凭证签发与登录会话](sessions.md)：展示基于 `pct1_...` 凭证换取 `pst1_...` 会话的完整工作流与跨协议鉴权（CLI / Portal / MCP）。
- [身份注销与凭证作废](revocation.md)：剖析软作废（Credential Revoke）与硬吊销（Identity Revoke）的机制差异及其安全回滚保证。
