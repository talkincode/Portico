# Portico

A governed portal for agents.

Agent 不在这里运行。  
Agent 在这里被发布、发现、授权和访问。

Portico 是组织的门廊：CLI、MCP、Web 都是入口，内部 / 公开 / 审批 / 分级权限是治理。日常维护委派给 Agent，人类只做安全审计。

运行时锁定为 **Deno + TypeScript（L0）**：不用 Node，不以 Bun 作为产品运行时。权限默认拒绝。见 [`docs/roadmap.md`](docs/roadmap.md) 的运行时边界。

## 文档

- 项目画像、功能清单与方向：[`docs/roadmap.md`](docs/roadmap.md)
- Agent 工作规范：[`AGENTS.md`](AGENTS.md)

## 开发

需要 Deno 2.9.x。不要用 Node 或 Bun 跑本仓库。

```sh
deno task lint
deno task check
deno task test
```

角色来自身份名册，不能靠 `--actor-role` 自封。空名册只能引导第一位人类审计者；之后由审计者授予 reader / maintainer / auditor。Agent 不能被授予 auditor。非匿名 catalog 命令会对照名册校验 `--actor-*`。

```sh
deno task cli -- identity grant \
  --identities ./data/identities.json \
  --id human:security-auditor \
  --kind human \
  --role auditor

deno task cli -- identity grant \
  --identities ./data/identities.json \
  --actor-id human:security-auditor \
  --actor-kind human \
  --actor-role auditor \
  --id agent:docs-bot \
  --kind agent \
  --role maintainer
```

撤回名册主体只属于人类审计者。被撤身份立即不能再写目录；留下的登记仍在。不能自撤，也不能撤走最后一位人类审计者。失败不改名册、不作废他人会话。

```sh
deno task cli -- identity revoke \
  --identities ./data/identities.json \
  --actor-id human:security-auditor \
  --actor-kind human \
  --actor-role auditor \
  --id agent:docs-bot
```

登录会话用一次性下发的凭证，只存哈希，不落明文口令。`--session` 可代替 `--actor-*`；Portal / Gateway 用 `Authorization: Bearer` 或 `X-Portico-Session`。

```sh
deno task cli -- identity credential issue \
  --identities ./data/identities.json \
  --sessions ./data/sessions.json \
  --actor-id human:security-auditor \
  --actor-kind human \
  --actor-role auditor \
  --id human:reader

deno task cli -- identity login \
  --identities ./data/identities.json \
  --sessions ./data/sessions.json \
  --id human:reader \
  --token pct1_…

deno task cli -- catalog list \
  --catalog ./data/catalog.json \
  --identities ./data/identities.json \
  --sessions ./data/sessions.json \
  --session pst1_…
```

作废登录凭证属于安全审计，不撤名册。人类审计者 `identity credential revoke` 会作废该主体尚未过期的凭证和会话（只标 `revokedAt`，仍只存哈希）；`--actor-*` 仍可用，身份还在。维护者、Agent、只读者与匿名得到 `FORBIDDEN`。没有可作废的凭证或会话得到 `INVALID_STATE`。失败不改名册、不作废他人会话。之后可重新 `credential issue`。

```sh
deno task cli -- identity credential revoke \
  --identities ./data/identities.json \
  --sessions ./data/sessions.json \
  --actor-id human:security-auditor \
  --actor-kind human \
  --actor-role auditor \
  --id human:reader
```

内部登记一条 CLI 表面并查询（stdout 为 JSON）：

```sh
deno task cli -- catalog register \
  --catalog ./data/catalog.json \
  --identities ./data/identities.json \
  --actor-id agent:docs-bot \
  --actor-kind agent \
  --actor-role maintainer \
  --input ./record.json

deno task cli -- catalog list \
  --catalog ./data/catalog.json \
  --identities ./data/identities.json \
  --actor-id human:reader \
  --actor-kind human \
  --actor-role reader
```

草稿与发布：

```sh
deno task cli -- catalog draft \
  --catalog ./data/catalog.json \
  --identities ./data/identities.json \
  --actor-id agent:docs-bot \
  --actor-kind agent \
  --actor-role maintainer \
  --input ./record.json

deno task cli -- catalog publish \
  --catalog ./data/catalog.json \
  --identities ./data/identities.json \
  --actor-id agent:docs-bot \
  --actor-kind agent \
  --actor-role maintainer \
  --id docs-writer \
  --visibility internal
```

已登记的 `draft` / `internal` 记录可由维护者更新名称、说明、版本、渠道或入口，不能直接改可见性或治理状态。待审与已公开记录必须先拒绝或撤回：

```sh
deno task cli -- catalog update \
  --catalog ./data/catalog.json \
  --identities ./data/identities.json \
  --actor-id agent:docs-bot \
  --actor-kind agent \
  --actor-role maintainer \
  --id docs-writer \
  --input ./record.json
```

`--visibility public` 只产生 `pending_public` 候选，匿名渠道仍不可见。独立人类审计者才能批准或拒绝：

```sh
deno task cli -- catalog approve \
  --catalog ./data/catalog.json \
  --identities ./data/identities.json \
  --actor-id human:security-auditor \
  --actor-kind human \
  --actor-role auditor \
  --id docs-writer

deno task cli -- catalog reject \
  --catalog ./data/catalog.json \
  --identities ./data/identities.json \
  --actor-id human:security-auditor \
  --actor-kind human \
  --actor-role auditor \
  --id docs-writer
```

提交同一请求的身份不能自批。维护者与 Agent 不能审。`--actor-*` 必须与身份名册一致；名册文件仍是本地信任根，不是登录会话或外部 IdP。公开可见性不能通过 `register` 或 `publish` 直接变成 `approved_public`。

撤回已公开的入口同样属于公开信任边界，因此与批准共用同一权限面——只有人类审计者能撤回。撤回后记录回到内部，匿名与组织外主体在 CLI、Portal 与 Gateway 上立即不可达，再次发布只回到公开候选，必须重新经独立审批：

```sh
deno task cli -- catalog withdraw \
  --catalog ./data/catalog.json \
  --identities ./data/identities.json \
  --actor-id human:security-auditor \
  --actor-kind human \
  --actor-role auditor \
  --id docs-writer
```

只有仍是 `approved_public` 的记录可以撤回；对内部、待审、已拒绝或已撤回的记录会得到 `INVALID_STATE`，失败不改目录、不写审批记录。

MCP 渠道登记外部 MCP Server。`mcp list` / `mcp describe` 只返回已授权连接信息，不执行工具、不代理流量。端点必须是 http(s) URL，不能带密钥或命令。

Web 渠道登记外部 Web 入口。`web list` / `web describe` 只返回已授权 href，不抓取、不代理页面。URL 必须是绝对 http(s)，不能带密钥、userinfo 或 `javascript:`。

```sh
deno task cli -- catalog register \
  --catalog ./data/catalog.json \
  --identities ./data/identities.json \
  --actor-id agent:docs-bot \
  --actor-kind agent \
  --actor-role maintainer \
  --input ./web-record.json

deno task cli -- web list \
  --catalog ./data/catalog.json \
  --identities ./data/identities.json \
  --actor-id human:reader \
  --actor-kind human \
  --actor-role reader

deno task cli -- web describe \
  --catalog ./data/catalog.json \
  --identities ./data/identities.json \
  --actor-id human:reader \
  --actor-kind human \
  --actor-role reader \
  --id docs-web
```

```sh
deno task cli -- catalog register \
  --catalog ./data/catalog.json \
  --identities ./data/identities.json \
  --actor-id agent:docs-bot \
  --actor-kind agent \
  --actor-role maintainer \
  --input ./mcp-record.json

deno task cli -- mcp list \
  --catalog ./data/catalog.json \
  --identities ./data/identities.json \
  --actor-id human:reader \
  --actor-kind human \
  --actor-role reader

deno task cli -- mcp describe \
  --catalog ./data/catalog.json \
  --identities ./data/identities.json \
  --actor-id human:reader \
  --actor-kind human \
  --actor-role reader \
  --id docs-mcp
```

MCP Gateway 只做门卫：按身份发出已授权的直连路由并追加访问审计，不执行工具、不代理 JSON-RPC。

```sh
deno task cli -- gateway authorize \
  --catalog ./data/catalog.json \
  --identities ./data/identities.json \
  --audit ./data/gateway-audit.json \
  --actor-id human:reader \
  --actor-kind human \
  --actor-role reader \
  --id docs-mcp

deno task cli -- gateway audit \
  --identities ./data/identities.json \
  --audit ./data/gateway-audit.json \
  --actor-id human:security-auditor \
  --actor-kind human \
  --actor-role auditor
```

只读 Portal 与 CLI 呈现同一治理状态，包括 `GET /api/mcp`、`GET /api/web` 与 `GET /api/page`。默认只绑 `127.0.0.1`，无 `--allow-write`。未带身份头或会话视为匿名；带上的 `X-Portico-Actor-*` 必须与名册一致。已登录时用 `Authorization: Bearer` 或 `X-Portico-Session`（`PORTICO_SESSIONS_PATH`）。页面文件可选：`PORTICO_PAGE_PATH`。发现页对当前身份可见的记录展示已授权入口，Web 为直连链接。

```sh
deno task portal
```

```sh
PORTICO_CATALOG_PATH=./data/catalog.json \
PORTICO_IDENTITIES_PATH=./data/identities.json \
PORTICO_BIND=127.0.0.1 \
PORTICO_PORT=8788 \
deno task portal
```

```sh
curl -s http://127.0.0.1:8788/api/catalog \
  -H 'x-portico-actor-id: human:reader' \
  -H 'x-portico-actor-kind: human' \
  -H 'x-portico-actor-role: reader'

curl -s http://127.0.0.1:8788/api/web \
  -H 'x-portico-actor-id: human:reader' \
  -H 'x-portico-actor-kind: human' \
  -H 'x-portico-actor-role: reader'
```

Gateway HTTP 默认 `127.0.0.1:8789`，需要审计文件写权限，仍不执行工具。

```sh
PORTICO_CATALOG_PATH=./data/catalog.json \
PORTICO_IDENTITIES_PATH=./data/identities.json \
PORTICO_GATEWAY_AUDIT_PATH=./data/gateway-audit.json \
PORTICO_BIND=127.0.0.1 \
PORTICO_PORT=8789 \
deno task gateway
```

```sh
curl -s -X POST http://127.0.0.1:8789/gateway/mcp/docs-mcp/authorize \
  -H 'x-portico-actor-id: human:reader' \
  -H 'x-portico-actor-kind: human' \
  -H 'x-portico-actor-role: reader'
```

受约束的门户组件盒不是 CMS。维护者只能组合固定种类：`catalog_card`、`catalog_detail`、`permission_hint`、`approval_status`、`audit_snippet`。页面引用不能让未审批对象公开可达。

```sh
deno task cli -- page set \
  --page ./data/page.json \
  --catalog ./data/catalog.json \
  --identities ./data/identities.json \
  --actor-id agent:docs-bot \
  --actor-kind agent \
  --actor-role maintainer \
  --input ./page.json

deno task cli -- page get \
  --page ./data/page.json \
  --catalog ./data/catalog.json \
  --identities ./data/identities.json \
  --actor-id human:reader \
  --actor-kind human \
  --actor-role reader
```

```sh
curl -s http://127.0.0.1:8788/api/page \
  -H 'x-portico-actor-id: human:reader' \
  -H 'x-portico-actor-kind: human' \
  -H 'x-portico-actor-role: reader'
```

人类安全审计视图只读。维护者与 Agent 不能读、不能改写。时间线合并目录变更、授权记录、公开审批，以及可选的 Gateway 访问审计。

```sh
deno task cli -- audit list \
  --catalog ./data/catalog.json \
  --identities ./data/identities.json \
  --actor-id human:security-auditor \
  --actor-kind human \
  --actor-role auditor
```

```sh
curl -s http://127.0.0.1:8788/api/audit \
  -H 'x-portico-actor-id: human:security-auditor' \
  -H 'x-portico-actor-kind: human' \
  -H 'x-portico-actor-role: auditor'
```

## 质量与验收

一级业务功能必须达到 [`docs/roadmap.md`](docs/roadmap.md) 验收矩阵的覆盖底线：Happy Path E2E、高风险失败路径、权限双角色、写操作失败恢复；新增一级功能必须同步补 E2E 并更新矩阵。
