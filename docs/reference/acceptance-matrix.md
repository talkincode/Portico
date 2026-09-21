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

能力行、风险级别与证据文件与 [`docs/roadmap.md`](../roadmap.md) 的「验收矩阵」逐行对应：那份矩阵是唯一权威，逐条覆盖范围（Happy Path / 失败路径 / 权限角色 / 失败恢复）以它为准，本页只做索引。`tests/docs_acceptance_matrix_test.ts` 会断言本页不遗漏任何一条能力行、顺序一致，且引用的证据文件真实存在。

| 一级功能模块 | 风险级别 | 核心测试证据文件 |
| :--- | :---: | :--- |
| **Registry 登记与目录** | 高 | `tests/catalog_service_test.ts`；`tests/web_channel_test.ts`；`tests/e2e/cli_catalog_e2e_test.ts` |
| **Registry 受治理表面更新** | 高 | `tests/catalog_update_test.ts`；`tests/web_channel_test.ts`；`tests/e2e/cli_update_e2e_test.ts` |
| **Publisher 内部发布** | 高 | `tests/catalog_publisher_test.ts`；`tests/e2e/cli_publish_e2e_test.ts` |
| **Approval 公开发布审批** | 高 | `tests/catalog_approval_test.ts`；`tests/e2e/cli_approval_e2e_test.ts`；`tests/e2e/catalog_approvals_e2e_test.ts` |
| **公开审批记录只读查询** | 高 | `tests/catalog_approval_test.ts`；`tests/portal_handler_test.ts`；`tests/portal_ui_test.ts`；`tests/mcp_protocol_test.ts`；`tests/e2e/catalog_approvals_e2e_test.ts`；`tests/e2e/portal_ui_e2e_test.ts` |
| **公开发布撤回** | 高 | `tests/catalog_withdraw_test.ts`；`tests/e2e/cli_withdrawal_e2e_test.ts` |
| **公开可达性以审批轨迹为准** | 高 | `tests/catalog_public_grant_test.ts`；`tests/e2e/public_grant_e2e_test.ts` |
| **公开边界与受众只读报告** | 高 | `tests/catalog_audience_test.ts`；`tests/e2e/catalog_audience_e2e_test.ts` |
| **公开边界整库巡检** | 高 | `tests/catalog_boundary_sweep_test.ts`；`tests/e2e/catalog_boundary_e2e_test.ts` |
| **Review 独立人类审核入口** | 高 | `tests/review_handler_test.ts`；`tests/e2e/review_http_e2e_test.ts`；`tests/e2e/system_up_e2e_test.ts` |
| **Portal 发现与仪表盘** | 中 | `tests/portal_handler_test.ts`；`tests/portal_magazine_test.ts`；`tests/portal_ui_test.ts`；`tests/catalog_dashboard_test.ts`；`tests/e2e/portal_discovery_e2e_test.ts`；`tests/e2e/portal_magazine_e2e_test.ts`；`tests/e2e/catalog_dashboard_e2e_test.ts` |
| **目录过滤查询** | 中 | `tests/catalog_query_test.ts`；`tests/portal_handler_test.ts`；`tests/portal_magazine_test.ts`；`tests/mcp_protocol_test.ts`；`tests/e2e/cli_catalog_e2e_test.ts`；`tests/e2e/catalog_query_e2e_test.ts`；`tests/e2e/portal_magazine_e2e_test.ts` |
| **Portal 双平面 UI 与颜色主题** | 中 | `tests/portal_ui_test.ts`；`tests/portal_theme_test.ts`；`tests/portal_review_entry_test.ts`；`tests/e2e/portal_ui_e2e_test.ts`；`tests/e2e/portal_review_entry_e2e_test.ts` |
| **Access Control 分级权限** | 高 | `tests/access_service_test.ts`；`tests/e2e/cli_access_e2e_test.ts` |
| **身份名册只读查询** | 高 | `tests/access_service_test.ts`；`tests/portal_handler_test.ts`；`tests/mcp_protocol_test.ts`；`tests/e2e/identity_roster_e2e_test.ts` |
| **授权轨迹只读查询** | 高 | `tests/access_service_test.ts`；`tests/portal_handler_test.ts`；`tests/mcp_protocol_test.ts`；`tests/e2e/identity_grants_e2e_test.ts` |
| **身份撤回轨迹只读查询** | 高 | `tests/access_revoke_test.ts`；`tests/portal_handler_test.ts`；`tests/mcp_protocol_test.ts`；`tests/e2e/identity_revokes_e2e_test.ts` |
| **当前会话身份只读查询** | 高 | `tests/access_service_test.ts`；`tests/portal_handler_test.ts`；`tests/mcp_protocol_test.ts`；`tests/e2e/identity_whoami_e2e_test.ts` |
| **登录会话只读查询** | 高 | `tests/access_session_test.ts`；`tests/portal_handler_test.ts`；`tests/mcp_protocol_test.ts`；`tests/e2e/identity_sessions_e2e_test.ts` |
| **登录凭证只读查询** | 高 | `tests/access_session_test.ts`；`tests/portal_handler_test.ts`；`tests/mcp_protocol_test.ts`；`tests/e2e/identity_credentials_e2e_test.ts` |
| **登录凭证作废轨迹只读查询** | 高 | `tests/access_credential_revoke_test.ts`；`tests/portal_handler_test.ts`；`tests/mcp_protocol_test.ts`；`tests/e2e/identity_credential_revokes_e2e_test.ts` |
| **名册可选邮箱** | 高 | `tests/access_service_test.ts`；`tests/e2e/identity_roster_e2e_test.ts` |
| **身份授权撤回** | 高 | `tests/access_revoke_test.ts`；`tests/audit_service_test.ts`；`tests/e2e/cli_identity_revoke_e2e_test.ts` |
| **登录会话** | 高 | `tests/access_session_test.ts`；`tests/e2e/cli_session_e2e_test.ts`；`tests/e2e/portal_session_e2e_test.ts` |
| **Portal Cloudflare Access JWT 映射** | 高 | `tests/access_cf_access_test.ts`；`tests/portal_handler_test.ts`；`tests/gateway_handler_test.ts`；`tests/e2e/portal_cf_access_e2e_test.ts` |
| **身份证明与信任根** | 高 | `tests/e2e/cli_access_e2e_test.ts`；`tests/portal_handler_test.ts`；`tests/mcp_protocol_test.ts`；`tests/e2e/portal_session_e2e_test.ts`；`tests/e2e/cli_session_e2e_test.ts` |
| **登录凭证作废** | 高 | `tests/access_credential_revoke_test.ts`；`tests/audit_service_test.ts`；`tests/e2e/cli_credential_revoke_e2e_test.ts` |
| **CLI 发布与查询** | 高 | `tests/e2e/cli_catalog_e2e_test.ts`；`tests/e2e/cli_publish_e2e_test.ts`；`tests/e2e/cli_approval_e2e_test.ts`；`tests/e2e/cli_access_e2e_test.ts` |
| **MCP 渠道登记与访问** | 高 | `tests/mcp_channel_test.ts`；`tests/mcp_protocol_test.ts`；`tests/e2e/cli_mcp_e2e_test.ts`；`tests/e2e/portal_mcp_e2e_test.ts`；`tests/e2e/mcp_list_e2e_test.ts`；`tests/portal_handler_test.ts` |
| **MCP 协议入口（只读治理发现）** | 高 | `tests/mcp_protocol_test.ts`；`tests/e2e/mcp_http_e2e_test.ts`；`tests/e2e/entrypoint_boot_e2e_test.ts`；`tests/e2e/system_up_e2e_test.ts` |
| **Web 渠道登记与已授权入口** | 高 | `tests/web_channel_test.ts`；`tests/catalog_update_test.ts`；`tests/mcp_protocol_test.ts`；`tests/e2e/cli_web_e2e_test.ts`；`tests/e2e/portal_web_e2e_test.ts`；`tests/e2e/web_list_e2e_test.ts`；`tests/portal_handler_test.ts` |
| **CLI 渠道登记与已授权包坐标** | 高 | `tests/cli_channel_test.ts`；`tests/mcp_protocol_test.ts`；`tests/e2e/cli_package_e2e_test.ts`；`tests/e2e/portal_cli_e2e_test.ts`；`tests/e2e/cli_list_e2e_test.ts`；`tests/portal_handler_test.ts` |
| **MCP Gateway 鉴权与路由** | 高 | `tests/gateway_service_test.ts`；`tests/gateway_handler_test.ts`；`tests/e2e/cli_gateway_e2e_test.ts`；`tests/e2e/gateway_http_e2e_test.ts` |
| **Gateway 访问审计只读查询** | 高 | `tests/gateway_service_test.ts`；`tests/portal_handler_test.ts`；`tests/mcp_protocol_test.ts`；`tests/e2e/gateway_audit_e2e_test.ts` |
| **UI Components 门户页维护** | 中 | `tests/ui_page_test.ts`；`tests/portal_page_handler_test.ts`；`tests/mcp_protocol_test.ts`；`tests/e2e/cli_page_e2e_test.ts`；`tests/e2e/portal_page_e2e_test.ts`；`tests/e2e/page_get_e2e_test.ts` |
| **Agent 维护与人类安全审计** | 高 | `tests/catalog_change_test.ts`；`tests/audit_service_test.ts`；`tests/portal_handler_test.ts`；`tests/e2e/cli_audit_e2e_test.ts`；`tests/e2e/portal_audit_e2e_test.ts` |
| **安全审计结论（维护权 ≠ 审计权）** | 高 | `tests/audit_conclusions_test.ts`；`tests/e2e/audit_conclusions_e2e_test.ts` |
| **审计时间线过滤查询** | 高 | `tests/audit_query_test.ts`；`tests/portal_handler_test.ts`；`tests/mcp_protocol_test.ts`；`tests/e2e/audit_query_e2e_test.ts` |
| **审计封条校验（篡改可指名）** | 高 | `tests/audit_seal_test.ts`；`tests/e2e/audit_seal_e2e_test.ts` |
| 审计封条外部锚定（整体重写与尾部截断可发现） | 高 | ✅ 人类审计者经 CLI `audit anchor` 钉住四支柱的 (pillar, seq, tip)；此后 CLI `audit verify --anchors`、Portal `GET /api/audit-verify` 与 MCP `portico_audit_verify` 报出同一份锚定结论（`anchored` 计数与每支柱 `anchor.state`），Portal `GET /api/seal-anchors` 与 MCP `portico_seal_anchors` 列出同一批检查点；未钉检查点时如实报 `anchored: 0`，不把未锚定的支柱冒充成已校验 | ✅ 记录与链条被整体重写（摘要全部重算、封条自洽、`ok:true`）被指名 `rewritten`；从尾部截断被指名 `truncated`；锚定过的 tip 出现在链上别处被指名 `moved`；链条正常增长不算篡改（仍 `intact`） | ✅ 人类审计者 vs 维护者/只读/匿名（后三者对 `audit anchor` / `audit anchors` 均 FORBIDDEN，且被拒的钉点不产生锚点文件）；Portal 与 MCP 只读，`POST /api/seal-anchors` 405 | ✅ 比对与列举全程只读：锚点文件与四支柱文件字节不变；把改动过的记录与链条还原后同一检查点重新 `intact`；第二个检查点追加在第一个之后，不覆盖既有证据 | `tests/audit_anchor_test.ts`；`tests/e2e/audit_anchor_e2e_test.ts` |
| **公开面脱敏（开源公开合同）** | 高 | `tests/public_surface_redaction_test.ts`；`tests/redaction.ts` |
| **运行时边界（L0 公开合同）** | 高 | `tests/runtime_boundary_test.ts`；`tests/runtime_boundary.ts` |
| **部署契约与入口健康门禁** | 中 | `tests/e2e/deploy_verify_e2e_test.ts`；`tests/deploy_contract_test.ts` |
| **macOS 生产部署门禁与运行修订** | 中 | `tests/e2e/deploy_macos_verify_e2e_test.ts`；`tests/deploy_macos_contract_test.ts` |
