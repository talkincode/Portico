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

MCP 渠道登记外部 MCP Server。`mcp list` / `mcp describe` 只返回已授权连接信息，不执行工具、不代理流量。端点必须是 http(s) URL，不能带密钥或命令。

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

只读 Portal 与 CLI 呈现同一治理状态，包括 `GET /api/mcp`。默认只绑 `127.0.0.1`，无 `--allow-write`。未带身份头视为匿名；带上的 `X-Portico-Actor-*` 必须与名册一致。

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
```

## 质量与验收

一级业务功能必须达到 [`docs/roadmap.md`](docs/roadmap.md) 验收矩阵的覆盖底线：Happy Path E2E、高风险失败路径、权限双角色、写操作失败恢复；新增一级功能必须同步补 E2E 并更新矩阵。
