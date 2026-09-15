# 身份注销与凭证作废

当 Agent 行为异常、凭证泄露或人员离职时，安全审计者需要迅速阻断其访问能力。Portico 提供了两级处置手段：**凭证作废（Credential Revocation）** 与 **身份注销（Identity Revocation）**。

---

## 凭证作废 vs 身份注销

| 维度 | 凭证作废 (`identity credential revoke`) | 身份注销 (`identity revoke`) |
| :--- | :--- | :--- |
| **操作目的** | 阻断失窃或泄露的密钥/会话，允许重新发放凭证 | 永久注销主体在名册中的资格 |
| **名册影响** | 主体保留在 `identities.json` 中 | 从 `identities.json` 中移除主体资格 |
| **会话影响** | 立即作废该主体名下所有活跃凭证与会话 | 立即导致持有原会话的任何请求判定为 `FORBIDDEN` |
| **历史产物** | 该主体登记的 Catalog 记录保留 | 该主体留下的历史 Catalog 与审计记录依然完整保留 |
| **后续恢复** | 审计者再次 `credential issue` 即可恢复使用 | 必须由审计者重新 `grant` 授予身份 |

---

## 凭证作废工作流

```bash
deno task cli -- identity credential revoke \
  --identities ./data/identities.json \
  --sessions ./data/sessions.json \
  --session $AUDITOR_SESSION \
  --id agent:compromised-bot
```

**执行保证**：
1. **两阶段原子提交**：系统首先将事件计入审计流水，随后将 `sessions.json` 中该主体的所有凭证打上 `revokedAt` 时间戳，并删除关联会话。若更新失败，状态自动回滚。
2. **免受无状态污染**：若该主体当前没有任何存活凭证或有效会话，命令将返回 `INVALID_STATE`，避免产生空写。

作废写入之后，轨迹本身是只读的。同一人类审计者经 CLI `identity credential revokes`、Portal `GET /api/credential-revokes` 与 MCP `portico_credential_revokes` 看到同一批追加式记录；维护者、只读者与匿名得到 `FORBIDDEN`。读操作不改名册或会话文件，也不是作废入口。

---

## 身份注销工作流

```bash
deno task cli -- identity revoke \
  --identities ./data/identities.json \
  --sessions ./data/sessions.json \
  --session $AUDITOR_SESSION \
  --id agent:retired-agent
```

**安全铁律保证**：
1. **禁止自撤**：审计者无法注销自己当前的会话主体（防止组织陷入无管理人的闭锁死局）。
2. **保护最后一位人类审计者**：系统禁止注销名册中仅剩的最后一名人类审计者。尝试此类操作将直接抛出 `INVALID_STATE`。
3. **独立性保障**：注销某一个主体绝不影响名册中其他无辜主体的凭证与会话。

撤回写入之后，轨迹本身是只读的。同一人类审计者经 CLI `identity revokes`、Portal `GET /api/revokes` 与 MCP `portico_revokes` 看到同一批追加式记录；维护者、只读者与匿名得到 `FORBIDDEN`。读操作不改名册，也不是撤回入口。
