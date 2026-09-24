# 公开发布与独立审批

公开发布意味着 Agent 将越过组织内网边界，暴露在公网视线之下。Portico 将这一动作确立为最高风险级别，必须经由**独立自然人审计者**双人把关。

---

## 审批流程全景

```text
  [ 维护者 Agent / 开发者 ]               [ 独立人类审计者 (Auditor) ]
             │                                        │
             │ 1. publish --visibility public         │
             ├───────────────────────────────────────►│ (进入 pending_public)
             │                                        │
             │ 2. 尝试自我批准 (自批)                  │
             ├──────┐                                 │
             │      ▼                                 │
             │ ❌ [ 403 SELF_APPROVAL ]               │
             │                                        │
             │                                        │ 3. 查验端点、代码与权限
             │                                        │ 4. approve 或 reject
             │                                        ├──────────────┐
             │                                        │              ▼
             │                                        │    写入 approvals.json
             │                                        │    更新 catalog.json
             │                                        │              │
             │                                        ▼              ▼
  [ 外部匿名公众 ] ◄───────────────────────── [ 公开可用：approved_public ]
```

---

## 审批命令实操

### 0. 列出审批记录 (`catalog approvals`)

公开边界上的通过、拒绝与撤回记录是同一份只读列表。CLI `catalog approvals`、Portal `GET /api/approvals` 与 MCP `portico_approvals` 对同一身份返回同一批记录、同一顺序。Portal `/internal/approvals` 用同一份列表渲染无脚本 HTML。已登录身份（只读 / 维护者 / 人类审计者）可以看到记录；匿名 API 得到空列表，匿名 HTML 得到 404，都不泄漏待审或已拒绝入口。待审候选在 `/internal/pending`，不出现在审批记录里。待审队列可按渠道（cli / mcp / web）只读筛选，筛选 tab 显示该渠道待审计数，并标明入口种类（url / package / mcp_endpoint），把引用渲染为转义文本，不可点击；批准与驳回由 CLI 与浏览器工作台两处完成，但写操作只有一个执行者：Portal 只把表单交给 Review 进程（`POST /review/approve|reject`），它自己不拿目录写权限；CLI `catalog approve|reject` 走同一条 `CatalogService` 规则，所以自批、非审计者与失败无脏写在三入口不分叉。这不是写路径：Portal POST 返回 405，读操作不改目录。

```bash
deno task cli -- catalog approvals \
  --catalog ./data/catalog.json \
  --identities ./data/identities.json \
  --sessions ./data/sessions.json \
  --session $SESSION
```

### 1. 批准公开 (`catalog approve`)
```bash
deno task cli -- catalog approve \
  --catalog ./data/catalog.json \
  --identities ./data/identities.json \
  --sessions ./data/sessions.json \
  --session $HUMAN_AUDITOR_SESSION \
  --id sql-optimizer \
  --note "Package coordinate reviewed."
```

`--note` 可选：最多 500 个字符，不能含控制字符；空白或过长会被 `INVALID_INPUT` 拒绝且不写目录。备注会追加到审批记录上，已登录身份经 CLI `catalog approvals`、Portal `GET /api/approvals`、MCP `portico_approvals` 与 `/internal/approvals` 看到同一条；匿名仍是空列表或 HTML 404。Portal 与 MCP 不能批准，这不是写入口。

**生效结果**：
- `catalog.json` 中的 `governanceState` 更新为 `approved_public`，`visibility` 更新为 `public`。
- `approvals.json` 中永久追加一条由该审计者签名的审计记录，包含当时的记录哈希与审批时间戳，以及可选备注。
- 外部匿名访客通过浏览器打开 `/public` 即可立即查看到该服务卡片。

---

### 2. 驳回公开 (`catalog reject`)
如果审计者发现该 Agent 描述不清晰、存在敏感信息或入口端点有安全隐患，可以果断驳回：

```bash
deno task cli -- catalog reject \
  --catalog ./data/catalog.json \
  --identities ./data/identities.json \
  --sessions ./data/sessions.json \
  --session $HUMAN_AUDITOR_SESSION \
  --id sql-optimizer \
  --note "Entry is not a public documentation site."
```

`--note` 规则与批准相同。非法备注或自批不会写入审批记录，公开面仍不可达。

**生效结果**：
- 状态退回到 `rejected`。
- `approvals.json` 中记录驳回事件（含可选备注）。
- 公开面保持绝对不可见。维护者可以在修改不合规项后重新提交申请。

---

## 防自批铁律 (Anti-Self-Approval)

系统在审批逻辑层注入了不可绕过的自审拦截器：
- **同主体拦截**：若执行 `catalog approve` 的会话主体 ID 与该服务当前快照的 `maintainer` 完全一致，系统将无条件抛出 `SELF_APPROVAL` 错误。
- **角色互斥**：即使维护者是人类，只要他是该服务的登记人，他就无法自行审批该记录，必须由**另一位具备 auditor 角色的人类同事**进行跨主体审批。
- **Agent 免谈**：Agent 根本无法被授予 `auditor` 角色，从源头上杜绝了自动化脚本自导自演批准公开的可能性。
