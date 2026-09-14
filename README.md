# Portico

A governed portal for agents.

Agent 不在这里运行。  
Agent 在这里被发布、发现、授权和访问。

Portico 是组织的门廊：CLI、MCP、Web 都是入口，内部 / 公开 / 审批 / 分级权限是治理。日常维护委派给 Agent，人类只做安全审计。

运行时锁定为 **Deno + TypeScript（L0）**：不用 Node，不以 Bun 作为产品运行时。权限默认拒绝。见 [`docs/roadmap.md`](docs/roadmap.md) 的运行时边界。

## 文档

- 项目画像、功能清单与方向：[`docs/roadmap.md`](docs/roadmap.md)
- 页面层与颜色主题规范：[`docs/ui-spec.md`](docs/ui-spec.md)
- Agent 工作规范：[`AGENTS.md`](AGENTS.md)

## 开发

需要 Deno 2.9.x。不要用 Node 或 Bun 跑本仓库。

```sh
deno task lint
deno task check
deno task test
```

## 起动整套系统

一条命令把 Portal 与 Gateway 一起点着。只需一个数据目录，其余路径从这里派生；空目录会在首次写入时自动建好：

```sh
PORTICO_DATA_DIR=./data deno task up
```

stdout 是一行机读 JSON，给出三个入口：

```json
{"ok":true,"data":{"dataDir":"./data","portal":{"url":"http://127.0.0.1:8788"},"gateway":{"url":"http://127.0.0.1:8789"},"mcp":{"url":"http://127.0.0.1:8790"}}}
```

`PORTICO_PORT`（Portal，默认 8788）、`PORTICO_GATEWAY_PORT`（Gateway，默认 8789）与 `PORTICO_MCP_PORT`（MCP，默认 8790）可改端口；`PORTICO_BIND` 接受 `127.0.0.1`、`localhost`，或 RFC1918 单播 IPv4（内网监听）。拒绝 `0.0.0.0`、`::` 与公网地址。`deno.json` 的默认 task 仍只授权 `127.0.0.1`；内网绑定请用 `deno task up`（按实际地址加 `--allow-net`）或在构建时设置 `PORTICO_BIND`。单个进程仍可分别用 `deno task portal` / `deno task gateway` / `deno task mcp` 起动。

`up` 是 supervisor，不是把入口合并：**Portal、Gateway、MCP 仍是三个进程，各带自己的权限集**——Portal 与 MCP 没有 `--allow-write`，这是治理属性，不是打包细节。任何一个退出，其余会被一起收走，不留半死系统。权限集集中声明在 `src/perms.ts`，`up`、`build` 与进程测试读同一份。

可分发产物：

```sh
deno task build
```

产到 `dist/`：`portico`（CLI）、`portico-portal`、`portico-gateway`、`portico-mcp`，各自内嵌自己的权限集，启动不依赖 `node`。`deno task build <target>` 可只构建一个。

### MCP 入口

Portal、CLI、MCP 是同一治理状态的三个入口。MCP 是**只读**服务端（JSON-RPC 2.0 over HTTP），暴露五个工具：`portico_list`、`portico_describe`、`portico_entry`、`portico_dashboard`、`portico_audit`。它们只是目录查询的投影，不执行、不代理、不编排任何外部工具。

鉴权只认会话，不接受 `X-Portico-Actor-*` 自称头：

```sh
curl -s -X POST http://127.0.0.1:8790 \
  -H 'content-type: application/json' \
  -H "Authorization: Bearer $PORTICO_SESSION" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"portico_list","arguments":{}}}'
```

匿名调用只会看到 `approved_public`；结果载荷与 CLI 是同一个 `{ok,data}` 信封。

角色来自身份名册。**身份必须有证明：非匿名命令只认登录会话**，`--actor-*` 单独出现会被拒绝——名册里的 id 是公开信息，把"抄一个 id"当成证明，等于让任何维护者都能批准自己的公开。空名册只能引导第一位人类审计者；之后由审计者授予 reader / maintainer / auditor。Agent 不能被授予 auditor。

空名册的引导只有两步，之后所有操作都要带 `--session`：

```sh
# 1. 第一位人类审计者（空名册，不需要身份参数）
deno task cli -- identity grant \
  --identities ./data/identities.json \
  --id human:security-auditor --kind human --role auditor

# 2. 一次性签发首张凭证：token 只打印一次，只存 SHA-256。
#    把它交给审计者本人，属于运维动作；签发后 bootstrap 永久关闭。
deno task cli -- identity credential issue \
  --identities ./data/identities.json \
  --sessions ./data/sessions.json \
  --id human:security-auditor

# 3. 用 token 换会话
deno task cli -- identity login \
  --identities ./data/identities.json \
  --sessions ./data/sessions.json \
  --id human:security-auditor --token pct1_…
```

下面的示例统一用 `--session pst1_…` 表示"该身份的登录会话"。信任根的边界是诚实的：名册与 `sessions.json` 是本地信任根，**对数据目录有写权限的主体可以重置它**，所以文件权限属于部署的一部分。

```sh
deno task cli -- identity grant \
  --identities ./data/identities.json \
  --id human:security-auditor \
  --kind human \
  --role auditor

deno task cli -- identity grant \
  --identities ./data/identities.json \
  --sessions ./data/sessions.json \
  --session pst1_… \
  --id agent:docs-bot \
  --kind agent \
  --role maintainer
```

撤回名册主体只属于人类审计者。被撤身份立即不能再写目录；留下的登记仍在。不能自撤，也不能撤走最后一位人类审计者。失败不改名册、不作废他人会话。

```sh
deno task cli -- identity revoke \
  --identities ./data/identities.json \
  --sessions ./data/sessions.json \
  --session pst1_… \
  --id agent:docs-bot
```

登录会话用一次性下发的凭证，只存哈希，不落明文口令。CLI 用 `--session`；Portal / Gateway / MCP 用 `Authorization: Bearer` 或 `X-Portico-Session`。**这是唯一的身份证明方式。**

```sh
deno task cli -- identity credential issue \
  --identities ./data/identities.json \
  --sessions ./data/sessions.json \
  --sessions ./data/sessions.json \
  --session pst1_… \
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

作废登录凭证属于安全审计，不撤名册。人类审计者 `identity credential revoke` 会作废该主体尚未过期的凭证和会话（只标 `revokedAt`，仍只存哈希）；重新 `credential issue` + `login` 即可再次进入，身份还在。维护者、Agent、只读者与匿名得到 `FORBIDDEN`。没有可作废的凭证或会话得到 `INVALID_STATE`。失败不改名册、不作废他人会话。之后可重新 `credential issue`。

```sh
deno task cli -- identity credential revoke \
  --identities ./data/identities.json \
  --sessions ./data/sessions.json \
  --sessions ./data/sessions.json \
  --session pst1_… \
  --id human:reader
```

内部登记一条 CLI 表面并查询（stdout 为 JSON）：

```sh
deno task cli -- catalog register \
  --catalog ./data/catalog.json \
  --identities ./data/identities.json \
  --sessions ./data/sessions.json \
  --session pst1_… \
  --input ./record.json

deno task cli -- catalog list \
  --catalog ./data/catalog.json \
  --identities ./data/identities.json \
  --sessions ./data/sessions.json \
  --session pst1_…

# 只在当前身份可见的 id / 名称 / 说明里过滤；不搜索入口 URL 或包坐标。
deno task cli -- catalog list \
  --catalog ./data/catalog.json \
  --identities ./data/identities.json \
  --sessions ./data/sessions.json \
  --session pst1_… \
  --q Writer --channel cli --state internal
```

Portal `GET /api/catalog?q=&channel=&state=` 与 MCP `portico_list` 使用同一过滤器。匿名仍然只看得到 `approved_public`。

治理仪表盘（计数，不是运行指标）三入口同一载荷：

```sh
deno task cli -- catalog dashboard \
  --catalog ./data/catalog.json \
  --identities ./data/identities.json \
  --sessions ./data/sessions.json \
  --session pst1_…
```

Portal `GET /api/dashboard` 与 MCP `portico_dashboard` 返回同一 `{counts,surfaces}`。匿名只计入 `approved_public`。

草稿与发布：

```sh
deno task cli -- catalog draft \
  --catalog ./data/catalog.json \
  --identities ./data/identities.json \
  --sessions ./data/sessions.json \
  --session pst1_… \
  --input ./record.json

deno task cli -- catalog publish \
  --catalog ./data/catalog.json \
  --identities ./data/identities.json \
  --sessions ./data/sessions.json \
  --session pst1_… \
  --id docs-writer \
  --visibility internal
```

已登记的 `draft` / `internal` / `rejected` 记录可由维护者更新名称、说明、版本、渠道或入口，不能直接改可见性或治理状态。`rejected` 可改是有意的——被拒绝的表面从未公开，把它做成终态会让"拒绝→修改→重新提交"这条路径走不通。待审与已公开记录仍必须先拒绝或撤回：

```sh
deno task cli -- catalog update \
  --catalog ./data/catalog.json \
  --identities ./data/identities.json \
  --sessions ./data/sessions.json \
  --session pst1_… \
  --id docs-writer \
  --input ./record.json
```

`--visibility public` 只产生 `pending_public` 候选，匿名渠道仍不可见。独立人类审计者才能批准或拒绝：

```sh
deno task cli -- catalog approve \
  --catalog ./data/catalog.json \
  --identities ./data/identities.json \
  --sessions ./data/sessions.json \
  --session pst1_… \
  --id docs-writer

deno task cli -- catalog reject \
  --catalog ./data/catalog.json \
  --identities ./data/identities.json \
  --sessions ./data/sessions.json \
  --session pst1_… \
  --id docs-writer
```

提交同一请求的身份不能自批。维护者与 Agent 不能审。角色始终以名册为准，自称不构成证明；Portal / Gateway / MCP 完全不接受 `X-Portico-Actor-*`。公开可见性不能通过 `register` 或 `publish` 直接变成 `approved_public`。

撤回已公开的入口同样属于公开信任边界，因此与批准共用同一权限面——只有人类审计者能撤回。撤回后记录回到内部，匿名与组织外主体在 CLI、Portal 与 Gateway 上立即不可达，再次发布只回到公开候选，必须重新经独立审批：

```sh
deno task cli -- catalog withdraw \
  --catalog ./data/catalog.json \
  --identities ./data/identities.json \
  --sessions ./data/sessions.json \
  --session pst1_… \
  --id docs-writer
```

只有仍是 `approved_public` 的记录可以撤回；对内部、待审、已拒绝或已撤回的记录会得到 `INVALID_STATE`，失败不改目录、不写审批记录。

MCP 渠道登记外部 MCP Server。`mcp list` / `mcp describe` 只返回已授权连接信息，不执行工具、不代理流量。端点必须是 http(s) URL，不能带密钥或命令。

Web 渠道登记外部 Web 入口。`web list` / `web describe` 只返回已授权 href，不抓取、不代理页面。URL 必须是绝对 http(s)，不能带密钥、userinfo 或 `javascript:`。

CLI 渠道登记包坐标。`cli list` / `cli describe` 只返回已授权 `jsr:` / `npm:` 坐标，不安装、不执行、不下载。坐标不能是命令、URL 或其它 registry。

```sh
deno task cli -- catalog register \
  --catalog ./data/catalog.json \
  --identities ./data/identities.json \
  --sessions ./data/sessions.json \
  --session pst1_… \
  --input ./web-record.json

deno task cli -- web list \
  --catalog ./data/catalog.json \
  --identities ./data/identities.json \
  --sessions ./data/sessions.json \
  --session pst1_…

deno task cli -- web describe \
  --catalog ./data/catalog.json \
  --identities ./data/identities.json \
  --sessions ./data/sessions.json \
  --session pst1_… \
  --id docs-web
```

```sh
deno task cli -- catalog register \
  --catalog ./data/catalog.json \
  --identities ./data/identities.json \
  --sessions ./data/sessions.json \
  --session pst1_… \
  --input ./cli-record.json

deno task cli -- cli list \
  --catalog ./data/catalog.json \
  --identities ./data/identities.json \
  --sessions ./data/sessions.json \
  --session pst1_…

deno task cli -- cli describe \
  --catalog ./data/catalog.json \
  --identities ./data/identities.json \
  --sessions ./data/sessions.json \
  --session pst1_… \
  --id docs-writer
```

```sh
deno task cli -- catalog register \
  --catalog ./data/catalog.json \
  --identities ./data/identities.json \
  --sessions ./data/sessions.json \
  --session pst1_… \
  --input ./mcp-record.json

deno task cli -- mcp list \
  --catalog ./data/catalog.json \
  --identities ./data/identities.json \
  --sessions ./data/sessions.json \
  --session pst1_…

deno task cli -- mcp describe \
  --catalog ./data/catalog.json \
  --identities ./data/identities.json \
  --sessions ./data/sessions.json \
  --session pst1_… \
  --id docs-mcp
```

MCP Gateway 只做门卫：按身份发出已授权的直连路由并追加访问审计，不执行工具、不代理 JSON-RPC。

```sh
deno task cli -- gateway authorize \
  --catalog ./data/catalog.json \
  --identities ./data/identities.json \
  --audit ./data/gateway-audit.json \
  --sessions ./data/sessions.json \
  --session pst1_… \
  --id docs-mcp

deno task cli -- gateway audit \
  --identities ./data/identities.json \
  --audit ./data/gateway-audit.json \
  --sessions ./data/sessions.json \
  --session pst1_…
```

只读 Portal 与 CLI 呈现同一治理状态，包括 `GET /api/mcp`、`GET /api/web`、`GET /api/cli` 与 `GET /api/page`。默认只绑 `127.0.0.1`，无 `--allow-write`。未带会话即匿名。已登录时用 `Authorization: Bearer` 或 `X-Portico-Session`（`PORTICO_SESSIONS_PATH`）；`X-Portico-Actor-*` 不构成证明，服务端不再读取。页面文件可选：`PORTICO_PAGE_PATH`。发现页对当前身份可见的记录展示已授权入口，Web 为直连链接，CLI 为包坐标。

### 页面层：两个平面

`/` 是兼容的多角色发现索引。页面层另有两条面向人的平面，共用一套语义 token：

| 平面 | 路由 | 读者 | 呈现 |
| --- | --- | --- | --- |
| 内部笔记台 | `/internal`、`/internal/c`、`/internal/audit`、`/internal/s/:id` | 只读及以上（匿名 404） | 治理状态、入口、维护者、治理路径、审计时间线 |
| 公开发布 | `/public`、`/public/t/:channel`、`/public/s/:id` | 任何人 | 仅 `approved_public` 的登记，按渠道分栏 |

公开页在视图层再筛一次：即使请求者是维护者，草稿、内部与待审公开也不进入公开页；未审批记录的
`/public/s/:id` 返回 404。审计路由只对人类审计者存在，其他身份得到 404。页面不含脚本、不引用
远程字体或图片，CSP 仍为 `default-src 'none'`。

颜色主题是四个固定预设（内部 / 公开 × 浅色 / 深色），用 `?theme=` 切换，解析顺序为 `?theme=` →
操作系统提示 → 平面默认；非法或跨平面取值静默降级。维护者不能自定义主题——界面不是可配置字段。
完整规范见 [`docs/ui-spec.md`](docs/ui-spec.md)。

```sh
http://127.0.0.1:8788/internal?theme=internal-dark
http://127.0.0.1:8788/public?theme=editorial-dark
```

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
  -H "Authorization: Bearer $PORTICO_SESSION"

curl -s http://127.0.0.1:8788/api/web \
  -H "Authorization: Bearer $PORTICO_SESSION"
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
  -H "Authorization: Bearer $PORTICO_SESSION"
```

受约束的门户组件盒不是 CMS。维护者只能组合固定种类：`catalog_card`、`catalog_detail`、`permission_hint`、`approval_status`、`audit_snippet`。页面引用不能让未审批对象公开可达。

```sh
deno task cli -- page set \
  --page ./data/page.json \
  --catalog ./data/catalog.json \
  --identities ./data/identities.json \
  --sessions ./data/sessions.json \
  --session pst1_… \
  --input ./page.json

deno task cli -- page get \
  --page ./data/page.json \
  --catalog ./data/catalog.json \
  --identities ./data/identities.json \
  --sessions ./data/sessions.json \
  --session pst1_…
```

```sh
curl -s http://127.0.0.1:8788/api/page \
  -H "Authorization: Bearer $PORTICO_SESSION"
```

人类安全审计视图只读。维护者与 Agent 不能读、不能改写。CLI `audit list`、Portal `GET /api/audit` 与 MCP `portico_audit` 呈现同一份时间线：目录变更、授权记录、公开审批，以及 Gateway 访问审计。三者共用 `--q` / `--kind` / `--action` / `--subject`（Portal 查询参数与 MCP 工具参数同名）：过滤发生在审计者鉴权之后，只匹配 id / 主体 / 摘要 / 动作，不搜索入口 URL。给 Portal / MCP 设置 `PORTICO_GATEWAY_AUDIT_PATH` 即并入 Gateway 事件；`deno task up` 会同时交给三个入口。

```sh
deno task cli -- audit list \
  --catalog ./data/catalog.json \
  --identities ./data/identities.json \
  --sessions ./data/sessions.json \
  --session pst1_…
```

```sh
curl -s http://127.0.0.1:8788/api/audit \
  -H "Authorization: Bearer $PORTICO_SESSION"
```

## 质量与验收

一级业务功能必须达到 [`docs/roadmap.md`](docs/roadmap.md) 验收矩阵的覆盖底线：Happy Path E2E、高风险失败路径、权限双角色、写操作失败恢复；新增一级功能必须同步补 E2E 并更新矩阵。
