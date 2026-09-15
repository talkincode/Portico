# 验收矩阵与质量底线

Portico 对所有已发布的一级业务功能执行铁律级的质量保障，详细业务能力矩阵维护于 [`docs/roadmap.md`](../roadmap.md) 中。

---

## 质量覆盖四大铁律 (MUST)

1. **Happy Path E2E**：每个一级功能必须至少有一条端到端（E2E）成功路径测试。
2. **高风险失败路径覆盖**：每个高风险功能必须至少覆盖一条失败路径（例如非法入参、偷写公开、伪造身份被拦截）。
3. **权限双角色覆盖**：每个涉及权限判定的功能，必须在用例中至少验证两种截然不同的角色（例如：有权 vs 无权，或维护者 vs 人类审计者）。
4. **失败状态零脏写**：每个修改底层状态的操作，必须验证在发生失败或异常中断后，底层文件状态无脏写且能够恢复或回滚。

---

## 核心业务能力证据清单

| 一级功能模块 | 风险级别 | 覆盖范围重点 | 核心测试证据文件 |
| :--- | :---: | :--- | :--- |
| **Registry 登记与目录** | 高 | 维护者登记内部表面，只读者读取；拦截非法偷写公开、明文密钥，以及指向自身阅读页的 Web 入口。 | `tests/catalog_service_test.ts`、`tests/web_channel_test.ts`、`tests/e2e/cli_catalog_e2e_test.ts` |
| **受治理表面更新** | 高 | 维护者更新 draft/internal/rejected；禁止直接改 pending_public/approved_public；禁止把 web entry 改成自身阅读页。 | `tests/catalog_update_test.ts`、`tests/e2e/cli_update_e2e_test.ts` |
| **Publisher 内部发布** | 高 | 草稿发布为内部；提交公开候选；匿名渠道保持完全不可见。 | `tests/catalog_publisher_test.ts`、`tests/e2e/cli_publish_e2e_test.ts` |
| **Approval 公开审批** | 高 | 人类审计者通过/驳回；严格触发 SELF_APPROVAL 拦截；禁止 Agent 审批。 | `tests/catalog_approval_test.ts`、`tests/e2e/cli_approval_e2e_test.ts` |
| **公开发布撤回** | 高 | 仅限审计者执行；撤回后多端瞬间切断；重提需重新走全流程审批。 | `tests/catalog_withdraw_test.ts`、`tests/e2e/cli_withdrawal_e2e_test.ts` |
| **Access Control 名册** | 高 | 空名册 Bootstrap 引导；禁止 Agent 担任 auditor；禁止注销唯一审计者。 | `tests/access_service_test.ts`、`tests/e2e/cli_access_e2e_test.ts` |
| **名册可选邮箱** | 高 | 人类身份可绑定唯一 email；Agent 不可带邮箱；列表不泄漏未知字段；邮箱不是第二证明。 | `tests/access_service_test.ts`、`tests/e2e/identity_roster_e2e_test.ts` |
| **Portal CF Access JWT 映射** | 高 | 默认关闭；合法 JWT 映射名册 email；伪造/过期/明文邮箱头匿名；不写会话；Gateway 不接受。 | `tests/access_cf_access_test.ts`、`tests/e2e/portal_cf_access_e2e_test.ts` |
| **登录凭证与会话** | 高 | 一次性凭证签发；SHA-256 哈希比对；伪造请求头全面拒绝。 | `tests/access_session_test.ts`、`tests/e2e/cli_session_e2e_test.ts` |
| **登录会话只读查询** | 高 | 人类审计者在 CLI / Portal / MCP 看到同一会话轨迹；维护者/只读/匿名拒绝；不泄漏令牌或哈希。 | `tests/access_session_test.ts`、`tests/e2e/identity_sessions_e2e_test.ts` |
| **登录凭证只读查询** | 高 | 人类审计者在 CLI / Portal / MCP 看到同一凭证轨迹；维护者/只读/匿名拒绝；不泄漏令牌或哈希。 | `tests/access_session_test.ts`、`tests/e2e/identity_credentials_e2e_test.ts` |
| **凭证作废与回滚** | 高 | 人类审计者作废泄露凭证；已作废凭证与会话瞬间失效；失败原子回滚。 | `tests/access_credential_revoke_test.ts`、`tests/e2e/cli_credential_revoke_e2e_test.ts` |
| **Portal 发现与双平面** | 中 | `/internal` 内部笔记台；`/public` 公开发布目录；主题平滑降级；零 JS。 | `tests/portal_ui_test.ts`、`tests/portal_theme_test.ts`、`tests/e2e/portal_ui_e2e_test.ts` |
| **MCP 渠道与网关鉴权** | 高 | 外部 MCP 连接信息发现；网关准入鉴权流水追加；严禁代理工具调用。 | `tests/mcp_channel_test.ts`、`tests/gateway_service_test.ts`、`tests/e2e/cli_gateway_e2e_test.ts` |
| **MCP 只读协议服务** | 高 | JSON-RPC 2.0 协议标准响应；portico_* 工具安全边界；只读无写权限。 | `tests/mcp_protocol_test.ts`、`tests/e2e/mcp_http_e2e_test.ts` |
