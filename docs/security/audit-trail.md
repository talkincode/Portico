# 追加写审计日志体系

Portico 拒绝可被任意篡改或静默清空的传统日志。系统的核心治理行为均转化为**结构化追加写审计事件（Append-Only Audit Trail）**。

"只能追加"是 API 的性质：没有任何命令可以 update 或 delete 一条记录。但记录终究是磁盘上的 JSON 文件，凡是拿到写权限的进程（或任何拿到 shell 的人）都能直接改写它。因此本文件分两层说明：**写入路径**（谁能产生一条记录）与**封条校验**（这些字节是否还是写入时的样子）。

---

## 审计事件源的四大支柱

系统的全局审计时间线（Timeline）由四类分散存储的底层记录归并排序生成：

```text
┌─────────────────────────────────────┐      ┌──────────────────────────────┐
│           catalog.json              │      │       identities.json         │
│  - records：登记本身（可变状态）     │      │  - identities：名册（可变状态）│
│  - changes：服务创建 / 更新 /        │      │  - grants：身份授予            │
│    内部发布 / 公开候选（追加写）     │      │  - revokes：身份注销           │
│  - approvals：公开批准 / 驳回 /      │      │  - credentialRevokes：凭证作废 │
│    撤回（追加写）                    │      │                               │
└──────────────┬──────────────────────┘      └───────────────┬──────────────┘
               │                                             │
               └──────────────────┬──────────────────────────┘
                                  ▼
               ┌────────────────────────────────────────────┐
               │      聚合审计时间线 (Audit Timeline)        │
               │   - 按 at 升序、再按 id 排序                │
               │   - 抹平不同存储源字段差异                  │
               └──────────────────┬─────────────────────────┘
                                  ▲
               ┌──────────────────┴─────────────────────────┐
               │                                            │
┌──────────────┴──────────────────────┐      ┌──────────────┴──────────────┐
│         gateway-audit.json          │      │       conclusions.json      │
│  - records：MCP Gateway 准入授权与   │      │  - conclusions：人类审计者   │
│    拒绝的流水（追加写）              │      │    的判定（追加写，独立存储）│
└─────────────────────────────────────┘      └─────────────────────────────┘
```

四个支柱各占一个文件，各自带一条独立的封条链（见下文），因此不存在"把 A 文件的封条搬到 B 文件"这种伪造路径。

---

## 审计事件结构规范

聚合时间线上的每条事件都是同一个信封：

```typescript
interface AuditEvent {
  /** 存储内唯一的事件 ID */
  id: string;

  /** 事件种类：catalog | grant | revoke | credential | approval | gateway */
  kind: AuditKind;

  /** 发生时间（ISO 8601），同时是排序主键 */
  at: string;

  /** 触发者：人类或 Agent，带当时角色 */
  actor: { id: string; kind: ActorKind; role?: ActorRole };

  /** 动作：register | update | publish_internal | approved | allowed | denied 等 */
  action: AuditAction;

  /** 事件指向的主体（登记 id 或身份 id） */
  subjectId: string;

  /** 人类可读摘要 */
  summary: string;

  /** 可选入口坐标。只在明确需要时出现，过滤与搜索都不碰它 */
  entry?: { kind: string; value: string };
}
```

`kind` 与 `action` 取值都是闭集（`src/audit/query.ts` 的 `AUDIT_KINDS` / `AUDIT_ACTIONS`）：过滤器出现闭集外的取值得到 `INVALID_INPUT`，而不是"什么都没匹配到"，这样拼错一个词不会静默返回空列表。

---

## 封条校验：追加写说了 API，封条说了字节

每条记录写入时，写入者同时追加一条**封条环节（seal entry）**，它覆盖这条记录，并指向前一个环节的摘要：

```typescript
interface SealEntry {
  seq: number;       // 1 起的链上位置
  kind: string;      // 该文件内的记录种类（change / approval / grant / ...）
  id: string;        // 该记录在文件内的 id
  digest: string;    // SHA-256(prev + kind + id + 记录的规范形式)
  prev: string;      // 前一个环节的 digest；seq=1 时是该支柱的 genesis 摘要
}
```

校验时重新计算整条链，回答一个具体问题：**这条链上的字节，是否还是写入时的样子**。

- 覆盖范围内某条记录被改写 → `reason: "digest"`，并指名是哪个 `id`、链上第几位。
- 覆盖范围内某条记录被删掉 → `reason: "missing"`。
- 链条被剪断、调序或插入 → `reason: "chain"`。
- 存在链没有覆盖的记录（写入前就有的历史数据，或绕过写入者塞进来的记录）→ 列进 `unsealed`，**不当作"已验证"**。
- 摘要按支柱绑定：`catalog` 链的环节无法在 `identity` 链里通过校验。

键序不影响结论：摘要算在记录的规范形式（键名排序、无空白）上，所以重新序列化一条记录不会读成篡改。这一点是刻意的——否则每次写盘格式变化都会变成"篡改"告警。

### 它证明什么，不证明什么

**能证明**：文件被就地改动、被删、被剪接，会被指名报出来；一次校验就能分辨"记录被改过"与"记录本来如此"。

**不能证明**：链条本身被整体重写。拿到写权限的人可以顺着改动重算后续所有环节——那时的链依然自洽，只是**链尾摘要（tip）与上一次不同**。因此校验结果总是返回 `tip`：把每期的 tip 记到外部（报告、运维日志）之后，"整体重写"就不再隐形，而会表现为 tip 变化。同理，**从尾部截断**后剩余链条仍然完整，只有与外部留存的 tip 比对才能发现。

一句话：封条把"改一条记录不留痕"变成"必须重写整条链，并留下一个新的 tip"。

### 外部锚定：把"整体重写"和"截断"也变成可发现的

封条只能证明"链内部自洽"。链被整体重写（连记录一起改、摘要全部重算）时它是自洽的，尾部被截断时剩下的是**一条更短但完好的链**——两者都 `ok:true`。把 tip 与链长记到链外的第二份文件，这两种擦除就有名字了：

```bash
# 只写操作，只给人类审计者：钉住四个支柱的 (pillar, seq, tip)
deno task cli -- audit anchor --anchors ./data/seal-anchors.json \
  --catalog ./data/catalog.json --identities ./data/identities.json \
  --sessions ./data/sessions.json --session $HUMAN_AUDITOR_SESSION \
  --audit ./data/gateway-audit.json --conclusions ./data/conclusions.json

# 只读：列出已钉的检查点
deno task cli -- audit anchors --anchors ./data/seal-anchors.json \
  --catalog ./data/catalog.json --identities ./data/identities.json \
  --sessions ./data/sessions.json --session $HUMAN_AUDITOR_SESSION

# 只读：校验时带上锚点，报告里每个支柱多一个 anchor
deno task cli -- audit verify --anchors ./data/seal-anchors.json ... # 同上四个路径
```

每个支柱得到四种判定之一：

- `intact`：锚定的那一段还在原位、摘要一致。**链条增长不算篡改**——检查点钉的是"那一段历史"，之后的正常记录不会让它过期。
- `moved`：锚定的 tip 还在链上，但已不在当时的位置（有人往前插了环节）。
- `truncated`：链条比锚定时更短。
- `rewritten`：锚定的位置上换了别的字节（长度可以相同）。

空链也能被钉：`seq: 0` 表示"这里当时什么都没有"。这样"事后整条链从零伪造出来"同样会被发现，而不是看起来从未有历史。

锚定不覆盖某支柱时，报告如实给 `anchored: 0`，**不把这个支柱当作已校验**——和 `unsealed` 不是"已验证"是同一条规矩。

**它自己的边界（如实写明）**：锚点文件与四个支柱在同一个 CLI、同一台机器上，拿到写权限的人可以把它一起删掉。它买到的是"不留痕"变成"必须动第二个文件"；要更强的证据，把每期的 tip 抄进 Mira 报告或外部运维日志——检查点很小、有序，本来就是给人抄录的。哪些检查点覆盖哪些支柱、何时由谁钉的，同样可在 Portal `GET /api/seal-anchors` 与 MCP `portico_seal_anchors` 上读到，但**钉新检查点只能在 CLI**：两个 HTTP 入口都是只读进程。

### 校验入口

只读、只给人类审计者（其他身份 `FORBIDDEN`，任何情况下都不写文件）：

```bash
deno task cli -- audit verify \
  --catalog ./data/catalog.json \
  --identities ./data/identities.json \
  --sessions ./data/sessions.json \
  --session $HUMAN_AUDITOR_SESSION \
  --audit ./data/gateway-audit.json \
  --conclusions ./data/conclusions.json
```

同一答案的三处入口：CLI `audit verify`、Portal `GET /api/audit-verify`、MCP `portico_audit_verify`，返回同一个 `{ok, unsealed, anchored, pillars:[...]}` 载荷。`anchored` 是"已被检查点覆盖的支柱数"，每个支柱在被钉过之后多一个 `anchor` 字段（`state` / `seq` / `tip` / `links` / `foundAt`）。CLI 的退出码只表示命令是否执行成功，**结论看载荷里的 `ok`、每个支柱的 `break`，以及 `anchor.state`**；门禁脚本也是这么读它的。

---

## 查询与检验方式

人类审计者可通过 CLI 查询聚合后的审计流水：

```bash
deno task cli -- audit list \
  --catalog ./data/catalog.json \
  --identities ./data/identities.json \
  --sessions ./data/sessions.json \
  --session $HUMAN_AUDITOR_SESSION
```

维护者（Maintainer）即使拥有写 Catalog 的权限，也没有任何"清空审计记录"或"修改审计时间戳"的命令可调；试图通过 CLI、API 或 MCP 篡改审计日志的请求不会被重新解释为一次合法写入。

---

## 审计结论：与维护轨迹分开存储

时间线记录的是**发生了什么**（谁登记、谁批准、谁被拒）。人类安全审计者的判断——公开边界是否守得住、入口指向何处、权限是否被放开、有无密钥泄漏、Gateway 是否越权——是**对事件的看法**，不是事件本身，因此单独存在 `conclusions.json` 里，**不并入上面的聚合时间线**。合并会让一条判定渲染得像一条系统事实。

```typescript
interface AuditConclusion {
  id: string;                      // ccl-<subject>-<scope>-<stamp>-<seq>
  subjectId: string;               // 被审计的目录登记，或仓库级边界契约 boundary:<name>
  scope: ConclusionScope;          // public_boundary | entry_target | permission_change | secret_leakage | gateway_scope | runtime_l0
  verdict: ConclusionVerdict;      // cleared | flagged
  auditorId: string;               // 写下判定的人类审计者
  at: string;                      // ISO 8601
  gate?: string;                   // 仅边界契约：回答它的门禁任务，如 check:runtime-boundary
  note?: string;                   // flagged 必填；含明文密钥或控制字符被拒
}
```

两个问题问的不是某一条登记，而是仓库整体：Deno L0 运行时边界（`runtime_l0`）与公开面脱敏。它们没有目录记录可以挂判定，也不该为此造一条假记录，因此是自带契约的**边界主体**——`boundary:runtime-l0`（门禁 `deno task check:runtime-boundary`）与 `boundary:public-redaction`（门禁 `deno task check:redaction`）。每个边界主体只回答一个问题，判定上因此带 `gate` 字段，把结论与可重跑的证据绑在一起。两个命名空间不会互相冒充：表面 id 是小写 kebab-case，带 `boundary:` 前缀的 id 注册成表面会被拒；`runtime_l0` 也不能用在对表面的判定上；不存在的边界 id 得到 `NOT_FOUND`。

约束与上述四大支柱一致，并额外要求审计独立性：

- **只能追加。** 没有 update、没有 delete；复评同一主体同一作用域会追加第二条记录，第一条仍然可读。重复 id 得到 `ALREADY_EXISTS`，不是覆盖。
- **只有人类审计者能写。** 维护者、只读者、匿名与 Agent 一律 `FORBIDDEN`；Agent 连 auditor 角色都拿不到，所以伪造 actor 是唯一入口，而它在这里同样被拒。
- **维护权 ≠ 审计权。** 审计者若是该主体的维护者之一，得到 `SELF_AUDIT`（与公开边界的 `SELF_APPROVAL` 同源），判定不落盘。
- **密钥只引用，不落明文。** note 走与目录同一套明文密钥扫描器，命中即 `INVALID_INPUT`。
- **受封条覆盖。** 结论文件与另外三个支柱一样带链，改写一条判定同样会被 `audit verify` 指名。

只读查询有三处同一答案：CLI `audit conclusions`、Portal `GET /api/conclusions`、MCP `portico_conclusions`。Portal 与 MCP 没有写权限，记录结论只能经 CLI `audit conclude`。
