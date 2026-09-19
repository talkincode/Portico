# 追加写审计日志体系

Portico 拒绝可被任意篡改或静默清空的传统日志。系统的核心治理行为均转化为**结构化追加写审计事件（Append-Only Audit Trail）**。

---

## 审计事件源的四大支柱

系统的全局审计时间线（Timeline）由四个分散存储的底层数据流归并排序生成：

```text
┌───────────────────────────┐      ┌───────────────────────────┐
│   catalog.json (changes)  │      │      approvals.json       │
│  - 服务创建 (register)     │      │  - 公开发布批准 (approved) │
│  - 服务更新 (update)       │      │  - 公开发布驳回 (rejected) │
│  - 状态流转 (publish)      │      │  - 公开服务撤回 (withdrawn)│
└─────────────┬─────────────┘      └─────────────┬─────────────┘
              │                                  │
              └────────────────┬─────────────────┘
                               │
                               ▼
            ┌─────────────────────────────────────────┐
            │       聚合审计时间线 (Audit Timeline)    │
            │          - 按时间戳降序全局排序           │
            │          - 抹平不同存储源字段差异         │
            └──────────────────┬──────────────────────┘
                               ▲
              ┌────────────────┴─────────────────┐
              │                                  │
┌─────────────┴─────────────┐      ┌─────────────┴─────────────┐
│      identities.json      │      │    gateway-audit.json     │
│  - 身份授予 (grant)        │      │  - MCP Gateway 准入授权   │
│  - 身份注销 (revoke)       │      │    (authorize) 流水       │
│  - 凭证作废 (credential)   │      │                           │
└───────────────────────────┘      └───────────────────────────┘
```

---

## 审计事件结构规范

所有审计事件最终投影为统一的信封结构：

```typescript
interface AuditEvent {
  /** 全局唯一事件 ID */
  id: string;

  /** 事件类型：catalog_register | catalog_update | approval | revoke | gateway_authorize 等 */
  type: string;

  /** 事件发生的时间戳 (ISO 8601) */
  timestamp: string;

  /** 触发此事件的主体 ID，例如 "human:auditor-bob" */
  actorId: string;

  /** 关联的服务 ID 或主体 ID */
  targetId: string;

  /** 详细审计载荷（含字段变更差分、版本号、裁决结果等） */
  details: Record<string, unknown>;
}
```

---

## 查询与检验方式

人类审计者可通过 CLI 查询聚合后的审计流水：

```bash
deno task cli -- audit list \
  --catalog ./data/catalog.json \
  --identities ./data/identities.json \
  --sessions ./data/sessions.json \
  --session $HUMAN_AUDITOR_SESSION \
  --limit 20
```

**不可篡改保证**：
- 维护者（Maintainer）即使拥有写 Catalog 的权限，也无法调用任何“清空审计记录”或“修改审计时间戳”的命令。
- 试图通过 CLI、API 或 MCP 篡改审计日志的请求将被直接判定为非法语义而拒绝。

---

## 审计结论：与维护轨迹分开存储

时间线记录的是**发生了什么**（谁登记、谁批准、谁被拒）。人类安全审计者的判断——公开边界是否守得住、入口指向何处、权限是否被放开、有无密钥泄漏、Gateway 是否越权——是**对事件的看法**，不是事件本身，因此单独存在 `conclusions.json` 里，**不并入上面的聚合时间线**。合并会让一条判定渲染得像一条系统事实。

```typescript
interface AuditConclusion {
  id: string;                      // ccl-<subject>-<scope>-<stamp>-<seq>
  subjectId: string;               // 被审计的目录登记
  scope: ConclusionScope;          // public_boundary | entry_target | permission_change | secret_leakage | gateway_scope
  verdict: ConclusionVerdict;      // cleared | flagged
  auditorId: string;               // 写下判定的人类审计者
  at: string;                      // ISO 8601
  note?: string;                   // flagged 必填；含明文密钥或控制字符被拒
}
```

约束与上述四大支柱一致，并额外要求审计独立性：

- **只能追加。** 没有 update、没有 delete；复评同一主体同一作用域会追加第二条记录，第一条仍然可读。重复 id 得到 `ALREADY_EXISTS`，不是覆盖。
- **只有人类审计者能写。** 维护者、只读者、匿名与 Agent 一律 `FORBIDDEN`；Agent 连 auditor 角色都拿不到，所以伪造 actor 是唯一入口，而它在这里同样被拒。
- **维护权 ≠ 审计权。** 审计者若是该主体的维护者之一，得到 `SELF_AUDIT`（与公开边界的 `SELF_APPROVAL` 同源），判定不落盘。
- **密钥只引用，不落明文。** note 走与目录同一套明文密钥扫描器，命中即 `INVALID_INPUT`。

只读查询有三处同一答案：CLI `audit conclusions`、Portal `GET /api/conclusions`、MCP `portico_conclusions`。Portal 与 MCP 没有写权限，记录结论只能经 CLI `audit conclude`。
