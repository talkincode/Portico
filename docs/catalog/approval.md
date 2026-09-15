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

### 1. 批准公开 (`catalog approve`)
```bash
deno task cli -- catalog approve \
  --catalog ./data/catalog.json \
  --identities ./data/identities.json \
  --sessions ./data/sessions.json \
  --session $HUMAN_AUDITOR_SESSION \
  --id sql-optimizer
```

**生效结果**：
- `catalog.json` 中的 `governanceState` 更新为 `approved_public`，`visibility` 更新为 `public`。
- `approvals.json` 中永久追加一条由该审计者签名的审计记录，包含当时的记录哈希与审批时间戳。
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
  --id sql-optimizer
```

**生效结果**：
- 状态退回到 `rejected`。
- `approvals.json` 中记录驳回事件。
- 公开面保持绝对不可见。维护者可以在修改不合规项后重新提交申请。

---

## 防自批铁律 (Anti-Self-Approval)

系统在审批逻辑层注入了不可绕过的自审拦截器：
- **同主体拦截**：若执行 `catalog approve` 的会话主体 ID 与该服务当前快照的 `maintainer` 完全一致，系统将无条件抛出 `SELF_APPROVAL` 错误。
- **角色互斥**：即使维护者是人类，只要他是该服务的登记人，他就无法自行审批该记录，必须由**另一位具备 auditor 角色的人类同事**进行跨主体审批。
- **Agent 免谈**：Agent 根本无法被授予 `auditor` 角色，从源头上杜绝了自动化脚本自导自演批准公开的可能性。
