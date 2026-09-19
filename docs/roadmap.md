# Portico 项目画像与方向

## 项目概述

Portico 是组织的 Agent **门户与治理层**：Agent 在别处运行，通过这里被登记、发布、发现、授权和访问。它提供 Web Portal、CLI、MCP 三类入口，把内部可见与公开可见分成两条信任边界；公开必须经过审批。系统按 CMS 式分级权限运转，但日常维护委派给 Agent，人类只做安全审计。

- 需修订（已修订）：原文写“当前仓库几乎是空的……没有运行时代码、测试或 CI”。2026-09-13 起仓库已有 Deno 运行时骨架、内部 Registry 目录、Publisher 草稿/内部发布/公开候选、Approval 公开发布审批、Access Control 身份名册、只读 Portal 发现、MCP 渠道登记与授权连接信息、MCP Gateway 鉴权/路由/访问审计（只做门卫，不执行工具、不代理流量）、人类安全审计视图、受约束的 UI Components 门户组件盒（固定种类，不能当 CMS），以及一次性下发的登录会话（哈希存储，非外部 IdP）、身份授权撤回（人类审计者撤回名册主体，不能自撤、不能撤最后一位审计者）、Registry 受治理表面更新（`catalog update`，只能改 `draft`/`internal` 记录，待审与已公开记录须先撤回/拒绝才能改），2026-09-14 的登录凭证作废（`identity credential revoke`，人类审计者作废凭证与会话但不撤名册），和 Web 渠道登记与已授权入口发现（CLI `web list`/`web describe`、Portal `GET /api/web` 与 MCP `portico_web` 共用 `listWeb`，同一身份看到同一批 href 与 `connect.mode=direct`，MCP 端点与 CLI 包坐标不会出现，匿名只看到已审批公开记录，不代理页面），以及 CLI 包坐标发现（CLI `cli list`/`cli describe`、Portal `GET /api/cli` 与 MCP `portico_cli` 共用 `listCli`，同一身份看到同一批 package 与 `connect.mode=coordinate`，MCP 端点与 Web href 不会出现，匿名只看到已审批公开记录，不安装不执行），以及 Portal 双平面页面层（内部笔记台与公开发布页、四个颜色主题预设、纯 CSS 主题切换），以及 `GET /` 社论杂志风发现壳（渠道过滤、明暗 `data-theme`、`/s/:id` 阅读栏，不是 CMS，不替代 `/internal` 与 `/public`，只读跨面入口：杂志壳↔`/public`，已登录才见 `/internal`），以及目录过滤查询（CLI `catalog list --q/--channel/--state`、Portal `GET /api/catalog` 与 MCP `portico_list` 共用同一过滤器，只匹配当前身份可见的 id/名称/说明，不搜索入口 URL 或包坐标），以及治理仪表盘（CLI `catalog dashboard`、Portal `GET /api/dashboard` 与 MCP `portico_dashboard` 共用 `dashboardFrom`，按当前身份可见性计数，不是运行指标大盘），以及审计时间线过滤查询（CLI `audit list --q/--kind/--action/--subject`、Portal `GET /api/audit` 与 MCP `portico_audit` 共用同一过滤器，只匹配当前审计者可见时间线的 id/主体/摘要/动作，不搜索入口 URL 或包坐标），以及身份名册只读查询（CLI `identity list`、Portal `GET /api/identities` 与 MCP `portico_identities` 共用 `AccessService.list`，返回 id/kind/role 与可选的人类 email，不泄漏凭证或会话，只读与匿名 FORBIDDEN），以及名册可选邮箱（人类审计者 `identity grant --email` 给人类身份绑定唯一地址，大小写归一；Agent 不可带邮箱；邮箱不是第二身份证明），以及 Portal 可选的 Cloudflare Access JWT 映射（默认关闭；只校验 `Cf-Access-Jwt-Assertion` 的签名与 aud/iss/exp，再用已校验 email 命中名册人类身份；明文邮箱头不是证明；失败为匿名且不写 identities/sessions；CLI / Gateway / MCP 仍只认会话），以及公开审批记录只读查询（CLI `catalog approvals`、Portal `GET /api/approvals` 与 MCP `portico_approvals` 共用 `listApprovals`，已登录身份看到同一批通过/拒绝/撤回记录，匿名得到空列表；Portal `/internal/approvals` 是同一批记录的无脚本 HTML，匿名 HTML 404），以及授权轨迹只读查询（CLI `identity grants`、Portal `GET /api/grants` 与 MCP `portico_grants` 共用 `AccessService.listGrants`，仅人类审计者看到同一批追加式授权记录，维护者/只读/匿名 FORBIDDEN），以及身份撤回轨迹只读查询（CLI `identity revokes`、Portal `GET /api/revokes` 与 MCP `portico_revokes` 共用 `AccessService.listRevokes`，仅人类审计者看到同一批追加式撤回记录，维护者/只读/匿名 FORBIDDEN），以及当前会话身份只读查询（CLI `identity whoami`、Portal `GET /api/whoami` 与 MCP `portico_whoami` 共用 `AccessService.whoami`，已登录身份看到自己的 id/kind/role，匿名 FORBIDDEN，载荷不含邮箱、凭证或会话），以及登录会话只读查询（CLI `identity sessions`、Portal `GET /api/sessions` 与 MCP `portico_sessions` 共用 `AccessService.listSessions`，仅人类审计者看到会话 id/主体/时间，不含令牌或哈希，维护者/只读/匿名 FORBIDDEN），以及登录凭证只读查询（CLI `identity credentials`、Portal `GET /api/credentials` 与 MCP `portico_credentials` 共用 `AccessService.listCredentials`，仅人类审计者看到凭证 id/主体/credentialRef/签发者/时间，不含令牌或哈希，维护者/只读/匿名 FORBIDDEN），以及登录凭证作废轨迹只读查询（CLI `identity credential revokes`、Portal `GET /api/credential-revokes` 与 MCP `portico_credential_revokes` 共用 `AccessService.listCredentialRevokes`，仅人类审计者看到同一批追加式凭证作废记录，维护者/只读/匿名 FORBIDDEN），以及 Gateway 访问审计只读查询（CLI `gateway audit`、Portal `GET /api/gateway-audit` 与 MCP `portico_gateway_audit` 共用 `listGatewayAudit`，仅人类审计者看到同一批允许/拒绝记录，维护者/只读/匿名 FORBIDDEN，读操作不写目录或审计文件），以及 MCP 连接信息只读查询（CLI `mcp list`、Portal `GET /api/mcp` 与 MCP `portico_mcp` 共用 `listMcp`，同一身份看到同一批 endpoint 与 `connect.mode=direct`，CLI 包坐标不会出现，匿名只看到已审批公开记录），以及门户组件盒只读查询（CLI `page get`、Portal `GET /api/page` 与 MCP `portico_page` 共用 `PageService.get`，同一身份看到同一组解析后的组件，匿名看不到内部卡片，读操作不写 page）；未实现的模块仍是产品意图，不是现存实现。

- 架构图

```text
                    ┌─────────────────────────────────────────┐
  Humans (审计)     │                 Portico                  │
  Agents (维护)     │                                         │
                    │  Portal ── Dashboard / 发现 / 门户页     │
        publish     │  Registry ── 目录、版本、可见性、引用     │
   CLI / MCP / API ─►  Publisher ── 内部发布 / 公开提交        │
                    │  Approval ── 跨越公开边界的审批          │
                    │  Access Control ── 分级权限 + Agent 身份 │
                    │  UI Components ── 受约束的门户组件       │
                    │  MCP Gateway ── 鉴权、路由、访问审计     │
                    │  CLI ── 发布、查询、状态机读输出         │
                    └─────────────┬───────────────────────────┘
                                  │ 不运行 Agent
                                  ▼
                    外部 Agent 运行时 / MCP Server / CLI 制品
```

数据流：维护者（人或 Agent）提交登记与发布 → Registry 成为唯一事实来源 → 内部立即按权限可见 → 公开进入 Approval → 通过后 Portal / CLI / MCP Gateway 才对外暴露入口。Portico 保存元数据、权限、审批与审计记录，不托管推理循环，不执行 Agent 工具。进程运行时见「运行时边界（L0）」。

## 项目画像（目标状态）

做好之后，组织能在一个地方回答：有哪些 Agent、以什么渠道存在、谁能看见、谁能调用、何时变成公开、变更由谁做出、安全审计看什么。

目标体验：

- 发布一条内部 CLI 或 MCP，一次调用完成，失败可机读。
- 公开发布不能“顺便成功”；未审批的公开入口在任何渠道都不可见、不可达。
- 仪表盘先给目录与治理状态，而不是运维大盘或模型监控。
- Agent 能维护目录、元数据、门户页；不能批准自己的公开、不能关闭审计、不能改他人的安全结论。
- 人类打开审计视图能看到谁改了什么、是否越界、公开入口指向何处。

关键品质与冲突时的优先级：

1. **信任边界正确**（内部 / 公开 / 审批）高于功能完整。
2. **可审计**高于编辑体验。改目录可以不漂亮，但不能没有记录。
3. **不运行 Agent** 高于“网关更方便”。网关只能鉴权、路由、记访问，不能执行工具或托管运行时。
4. **机读失败**高于交互花活。CLI / MCP / API 的错误必须可判定。
5. **一致性**高于自定义。门户组件是受约束的组件盒，不是建站器。

设计取向：Portico 像门廊，不像机房。Registry 是内核；Portal、CLI、MCP 只是同一治理状态的不同入口。运行时用 Deno 的默拒权限模型对齐产品的信任边界，而不是用更快的全开运行时换迭代速度。

## 运行时边界（L0，铁律）

用户已选定 L0，这是硬边界，不是建议。

- 系统运行时是 **Deno + TypeScript**。Portal、API、Portico CLI、MCP Gateway、检查与测试都在这一个运行时上。
- **不使用 Node** 作为运行时、包管理根基或测试运行器。
- **不以 Bun 作为产品运行时。** 禁止 Deno / Bun / Node 双运行时或第二套锁文件。
- 权限默认拒绝。网络、文件系统、环境变量必须显式白名单；禁止用全开权限把默拒掏空。
- `npm:` 导入只允许作为适配层。某个 SDK 不适配，先隔离适配，不改换平台。
- CLI 以 Deno 可分发产物提供，启动不依赖 `node` 可执行文件。

## 当前能力清单

- 定位陈述

`README.md` 写明：Portico 是受治理的 Agent 门户；Agent 不在这里运行，而在这里被发布、发现、授权和访问。

- 运行时骨架（Deno L0）

`deno.json` + `.github/workflows/ci.yml`。检查与测试走 `deno lint` / `deno check` / `deno test`。产品命令不使用 `--allow-all`，CLI 仅 `--allow-read --allow-write --allow-env`，Portal 仅 `--allow-read --allow-env --allow-net=127.0.0.1`（无 `--allow-write`），Gateway 仅 `--allow-read --allow-write --allow-env --allow-net=127.0.0.1`（写权限只为访问审计文件）。无 `package.json`、无 Node/Bun 锁文件。

- 一键起动与可分发产物

`src/up/main.ts`（`deno task up`）用一条 `PORTICO_DATA_DIR` 起动整套系统：Portal、Gateway 与 MCP 是**三个子进程**，各自带自己的权限集（Portal 与 MCP 仍无 `--allow-write`），任一退出则其余一起收走，不留半死系统；stdout 为一行机读 JSON，给出 `portal` / `gateway` / `mcp` 三个入口 URL。`src/build/main.ts`（`deno task build`）用 `deno compile` 产出 `dist/` 下四个产物（`portico` / `portico-portal` / `portico-gateway` / `portico-mcp`），各自内嵌权限集，启动不依赖 `node`。权限集集中声明在 `src/perms.ts`，`up`、`build` 与进程测试读同一份，不会各写一套。内网测试部署的三份 `deploy/run-*.sh` 与三份 `deploy/portico-*.service` 版本化：systemd 必须 ExecStart 仓库脚本，仓库默认绑定 `127.0.0.1:8788/8789/8790`，真实 RFC1918 地址只在安装现场注入，不得指向未审查的额外副本；这是测试环境，不是生产上线。

- Registry 内部目录

`src/catalog/` 是目录内核。维护者可登记内部 Agent 表面（身份、名称、说明、渠道、版本、入口引用、维护者、治理状态=`internal`）。公开可见性不能通过登记“顺便成功”；未知字段或明文密钥字段被拒绝——扫描覆盖 name/description/version 里嵌入的密钥子串（含 AWS Access Key ID `AKIA`/`ASIA` 形值、Google API Key `AIza` 形值、PEM 私钥头 `-----BEGIN ... PRIVATE KEY-----` 与 npm 访问令牌 `npm_` 形值，不含区域名 `asia-pacific`），以及 URL/MCP endpoint 的查询值、fragment、路径与包坐标，不只是整段值匹配；失败不写目录。只读者可见内部记录，匿名不可见。

- Registry 受治理的表面更新

已登记的 `draft` / `internal` / `rejected` 记录可由维护者 `catalog update --id <id> --input <file>` 更新名称、说明、版本、渠道、入口（不能直接改 `visibility` / `governanceState`）；渠道与入口一起改会重新校验 MCP / Web 一致性。`rejected` 可编辑是有意的：被拒绝的表面从未越过边界，它的唯一结果是"这次提交失败"；把它做成终态会让"拒绝→修改→重新提交"这条已写明的路径不可能成立，并永久污染该 id。`pending_public`（待审）与 `approved_public`（已公开）的记录仍不能直接更新——必须先 `reject` / `withdraw`；重新 `publish` 只回到待审，仍须独立审批，因此边界没有被削弱。未知字段、明文密钥字段与空更新被拒；失败不写目录。

- CLI 目录登记、草稿、发布、更新与查询

`src/cli/main.ts`：`identity grant|revoke|list|grants|revokes|sessions|credentials|credential issue|credential revoke|credential revokes|login|logout|whoami`、`catalog register|draft|publish|update|approve|reject|withdraw|approvals|dashboard|list|get`、`mcp list|describe`、`web list|describe`、`cli list|describe`、`gateway authorize|audit`、`audit list` 与 `page set|get`，一次调用结束，stdout 为 `{ok,data}` / `{ok,error:{code,message}}`。`catalog dashboard` 与 Portal `GET /api/dashboard`、MCP `portico_dashboard` 共用 `src/catalog/dashboard.ts`：只对当前身份可见的记录计数，读操作不写目录。`catalog list` 接受 `--q` / `--channel` / `--state`，与 Portal `GET /api/catalog`、MCP `portico_list` 共用 `src/catalog/query.ts`：过滤发生在可见性判定之后，只匹配 id / 名称 / 说明，不搜索入口 URL 或包坐标；非法过滤器 `INVALID_INPUT`，失败不写目录。非匿名命令必须用登录后的 `--session` 证明身份；`--actor-*` 单独出现会被拒绝（`USAGE`），不带任何身份参数即匿名。Portal 在显式启用时可把已校验的 Cloudflare Access JWT 映射到名册 email；CLI / Gateway / MCP 没有这条路径。

- Publisher 内部发布与公开候选

维护者可以把草稿发布为内部（只读者立即可见），或把内部/草稿提交为公开候选（`governanceState=pending_public`）。公开候选对匿名仍不可见、不可达；不能经 publish 写成 `approved_public`；无权或非法字段失败后不脏写。

- Approval 公开发布审批

独立人类审计者可 `approve` / `reject` 公开候选，并可附带可选 `--note`（最多 500 字符，无控制字符）。提交同一请求的身份不能自批（`SELF_APPROVAL`）；维护者与 Agent 不能审。通过后匿名可见 `approved_public`；拒绝后公开面仍不可达。**审批同时是内网坐标的边界检查**：`approve` 会拒绝入口只在网内可达的候选（RFC1918、回环、链路本地、IPv6 ULA/链路本地、IPv4-mapped 写法、以及公网 DNS 不可能有的单标签主机名），返回 `INVALID_STATE` 且不写审批记录、匿名仍不可达——否则批准动作会把内网拓扑搬到公开面。这条规则只挂在跨界动作上：内部记录携带内网 entry 仍是合法的内部登记，`reject` 也不受限制（拒绝是收缩方向）。修复路径是 `reject` → `catalog update` 改成公网入口 → 重新 `publish` + 独立 `approve`，id 不被毒化。审批记录与目录记录分开追加，维护者不能改写；备注写在审批记录上，不能事后改。非法备注、自批或越权失败不写审批记录、不改公开面。审批者必须持有名册中被授予 human auditor 的**会话**；角色以名册为准，自称不构成证明。`catalog approvals`、Portal `GET /api/approvals` 与 MCP `portico_approvals` 共用 `CatalogService.listApprovals`：已登录身份看到同一批通过/拒绝/撤回记录（含可选 `note`）与同一顺序；匿名得到空列表，不泄漏待审、已拒绝入口或备注。Portal `/internal/approvals` 用同一份 `listApprovals` 渲染无脚本 HTML，已登录身份看到同一批记录与备注，匿名得到 HTML 404 且不泄漏名称或备注；待审候选不会出现在这份轨迹里。读操作不写目录。Portal 与 MCP 不能批准或驳回。

- 撤回公开发布

已 `approved_public` 的记录可由人类审计者 `catalog withdraw --id <id>` 撤回（可选 `--note`，规则与批准/驳回相同）：记录回到 `governanceState=internal`、`visibility=internal`，公开入口（CLI、Portal、Gateway）对匿名与组织外主体立即消失，响应不泄漏端点；只读及以上身份仍可见同一条内部记录。撤回是公开信任边界的收缩方向，因此与批准同一权限面：只有人类审计者能撤回，维护者、Agent、只读者与匿名得到 `FORBIDDEN`。只有仍然公开的记录可撤回，`internal` / `pending_public` / `rejected` 得到 `INVALID_STATE`，重复撤回同样 `INVALID_STATE`。撤回在审批轨迹中留下 `withdrawn` 记录（谁撤回、何时、撤回的是哪个版本、可选备注），维护者不能改写。撤回后再次 `publish --visibility public` 只回到 `pending_public`，必须重新经独立审批才能重新公开。失败撤回不写目录、不追加审批记录。

- Access Control 身份名册

`src/access/` 保存身份与追加式授权记录。空名册只能引导第一位人类审计者；之后仅人类审计者可 grant。Agent 不能被授予 auditor；主体不能给自己提权。失败不写名册。catalog CLI 用名册解析角色。`identity list`、Portal `GET /api/identities` 与 MCP `portico_identities` 共用 `AccessService.list`：维护者与人类审计者看到同一批 `{id,kind,role}`，只读者与匿名得到 `FORBIDDEN`，载荷不含凭证、会话或哈希。`identity grants`、Portal `GET /api/grants` 与 MCP `portico_grants` 共用 `AccessService.listGrants`：仅人类审计者看到同一批追加式授权记录与同一顺序；维护者、只读者与匿名得到 `FORBIDDEN`，载荷不含凭证、会话或哈希。`identity revokes`、Portal `GET /api/revokes` 与 MCP `portico_revokes` 共用 `AccessService.listRevokes`：仅人类审计者看到同一批追加式身份撤回记录与同一顺序；维护者、只读者与匿名得到 `FORBIDDEN`，载荷不含凭证、会话或哈希。`identity whoami`、Portal `GET /api/whoami` 与 MCP `portico_whoami` 共用 `AccessService.whoami`：已登录身份看到自己的 `{id,kind,role}`，匿名得到 `FORBIDDEN`，载荷不含邮箱、凭证或会话。`identity sessions`、Portal `GET /api/sessions` 与 MCP `portico_sessions` 共用 `AccessService.listSessions`：仅人类审计者看到同一批会话轨迹（id / 主体 / 创建与过期时间，作废则含 `revokedAt`）与同一顺序；维护者、只读者与匿名得到 `FORBIDDEN`，载荷不含令牌或哈希。`identity credentials`、Portal `GET /api/credentials` 与 MCP `portico_credentials` 共用 `AccessService.listCredentials`：仅人类审计者看到同一批凭证轨迹（id / 主体 / credentialRef / 签发者 / 签发时间，作废则含 `revokedAt`）与同一顺序；维护者、只读者与匿名得到 `FORBIDDEN`，载荷不含令牌或哈希。`identity credential revokes`、Portal `GET /api/credential-revokes` 与 MCP `portico_credential_revokes` 共用 `AccessService.listCredentialRevokes`：仅人类审计者看到同一批追加式凭证作废记录与同一顺序；维护者、只读者与匿名得到 `FORBIDDEN`，载荷不含令牌或哈希。名册是**被委派主体的登记簿**，不是凭证：没有会话时任何 `--actor-*` 都不构成证明。名册与 `sessions.json` 仍是本地信任根——对数据目录有写权限的主体可以重置它，因此文件权限属于部署的一部分，不属于代码。外部断言不能创建名册记录。

- 本地持久化与写序

所有 store 都是整文件 JSON：临时文件写入后 `rename` 落地（同目录，原子）。同一进程内对同一文件的读-改-写**串行化**——`await` 会交错，两次并发调用会各自载入、各自修改、后写覆盖先写；Gateway 每个请求都要追加访问审计，丢一条就是审计缺口而非数据抖动。临时文件固定为 `<path>.tmp`（部署的 `--allow-write` 白名单正是这两个路径，唯一后缀会被拒）。**每个文件只允许一个写进程**：跨进程并发仍可能互相覆盖，`up` 与部署脚本都按此假设组织（Gateway 是 `gateway-audit.json` 的唯一写者）。这是当前规模的取舍，不是终态设计。

- 身份证明与信任根

非匿名写操作与 CLI / Gateway / MCP **只能**由登录会话证明。CLI `--actor-*` 单独出现即拒绝（`USAGE`，不写任何文件）；Portal / Gateway / MCP 完全不接受 `X-Portico-Actor-*`，伪造头只得到匿名视图。Portal 在显式启用时可以把已校验的 Cloudflare Access JWT 映射到名册，仍然不是自称头，也不会签发会话。空名册的引导路径有且只有两条：第一位人类审计者的 `identity grant`（无 actor），以及**一次性**的首张凭证 `identity credential issue`（无 actor，仅当系统从未签发过任何凭证、且主体是人类审计者）。凭证 token 只显示一次、只存 SHA-256，因此它是数据目录中唯一无法被读者还原的秘密；把它交给人类审计者属于运维动作。首个凭证签发后，bootstrap 永久关闭，之后每一次签发都必须由现有审计者会话发起。信任根的边界是诚实的：对数据目录有写权限的主体可以重置名册，因此文件权限属于部署的一部分。

- 身份授权撤回

已在名册中的身份可由独立人类审计者 `identity revoke --id <id>` 撤回：该身份立即从现行名册消失，`resolve` 与既有会话都不再把它当成有效主体；既有 grant 记录保持追加式不可改写，并另追加一条 revoke 记录（谁撤、何时、撤的是哪个角色）。维护者、Agent、只读者与匿名得到 `FORBIDDEN`。主体不能撤自己；最后一位人类审计者得到 `INVALID_STATE`，避免名册无人可审。未知或已撤回的 id 得到 `NOT_FOUND`。明文密钥字段被拒。失败撤回不改 identities/grants/revokes，也不作废会话或凭证。成功撤回会作废该主体尚未过期的会话和已签发凭证（只标 `revokedAt`，仍只存哈希）；重新 grant 需要新的凭证。被撤维护者留下的目录记录仍在，只是他们不能再写。撤回轨迹进入人类安全审计视图，维护者不能读、不能改写。同一人类审计者经 CLI `identity revokes`、Portal `GET /api/revokes` 与 MCP `portico_revokes` 看到同一批追加式撤回记录；读操作不改名册。

- Portal 发现与治理仪表盘

`src/portal/` 是只读 HTTP 入口，消费同一 `CatalogService`。`GET /api/catalog`、`GET /api/catalog/:id`、`GET /api/dashboard`（与 CLI `catalog dashboard`、MCP `portico_dashboard` 同一载荷）、`GET /api/mcp`、`GET /api/mcp/:id`、`GET /api/web`、`GET /api/web/:id`、`GET /api/cli`、`GET /api/cli/:id`、`GET /api/audit`、`GET /api/identities`（与 CLI `identity list`、MCP `portico_identities` 同一载荷，仅维护者与人类审计者）、`GET /api/grants`（与 CLI `identity grants`、MCP `portico_grants` 同一载荷，仅人类审计者）、`GET /api/revokes`（与 CLI `identity revokes`、MCP `portico_revokes` 同一载荷，仅人类审计者，维护者/只读/匿名 FORBIDDEN）、`GET /api/whoami`（与 CLI `identity whoami`、MCP `portico_whoami` 同一载荷，已登录看到自己，匿名 FORBIDDEN）、`GET /api/sessions`（与 CLI `identity sessions`、MCP `portico_sessions` 同一载荷，仅人类审计者，维护者/只读/匿名 FORBIDDEN）、`GET /api/credentials`（与 CLI `identity credentials`、MCP `portico_credentials` 同一载荷，仅人类审计者，维护者/只读/匿名 FORBIDDEN）、`GET /api/credential-revokes`（与 CLI `identity credential revokes`、MCP `portico_credential_revokes` 同一载荷，仅人类审计者，维护者/只读/匿名 FORBIDDEN）、`GET /api/gateway-audit`（与 CLI `gateway audit`、MCP `portico_gateway_audit` 同一载荷，仅人类审计者，维护者/只读/匿名 FORBIDDEN）、`GET /api/page`（与 CLI `page get`、MCP `portico_page` 同一载荷；匿名看不到内部卡片）、`GET /api/approvals`（与 CLI `catalog approvals`、MCP `portico_approvals` 同一载荷；已登录可见，匿名为空列表）与 HTML `GET /`、`GET /s/:id` 对同一身份呈现与 CLI 相同的可见性（审计面仅人类审计者）。`GET /` 是社论杂志风发现壳（PORTICO 顶栏、内容/专题/收藏展示、渠道过滤、明暗 `data-theme`、精选 hero），映射的仍是 Agent 表面目录，不是文章 CMS；`GET /s/:id` 是阅读栏。匿名只能看见 `approved_public`；内部详情对匿名为 HTML 404 且不泄漏入口。收藏为展示项，无写入。发现页对可见记录展示已授权入口：Web 为直连 http(s) 链接，CLI 为转义后的包坐标，其它渠道为转义后的引用，不代理页面。`/internal` 与 `/public` 双平面仍是正式页面层，杂志壳不替代它们。三层之间只有只读入口：杂志壳链到 `/public`，已登录身份才链到 `/internal` 并把未过滤的待审计数链到 `/internal/pending`，公开发布面链回 `/`，公开详情可链到同一条 `/s/:id`；匿名 `/internal` 与 `/internal/pending` 仍 404。无会话且无已校验 JWT 为匿名；`X-Portico-Actor-*` 不构成证明，Portal 不再读取，伪造头只得到匿名视图。`Authorization: Bearer` / `X-Portico-Session` 解析已登录会话且角色以名册为准；会话优先于 JWT。人看的页面（`/internal*`、`/public*`、`/`、`/s/:id`）找不到或无权看见时返回 HTML 404，不返回 JSON 信封，也不泄漏记录名；`/api/*` 仍是 `{ok,error}` JSON。默认绑定 `127.0.0.1`，也接受 RFC1918 单播 IPv4。POST/PUT/PATCH/DELETE 返回 405，不写目录。登录在 CLI 完成；Portal 只读消费会话文件，JWT 映射也不写会话。

- MCP 渠道登记与访问

维护者可登记 `channels=["mcp"]` 且 `entry.kind=mcp_endpoint` 的外部 MCP Server。端点必须是绝对 http(s) URL，禁止 userinfo、查询串密钥和命令式入口。`mcp list` / `mcp describe` 与 Portal `GET /api/mcp` 对同一身份返回连接信息 `{endpoint, connect:{mode:"direct"}}`，由客户端直连；Portico 不执行工具、不代理流量。可见性与目录相同：内部对匿名不可见，公开须审批。CLI 表面不会出现在 MCP 列表。失败登记不写目录。

- MCP 协议入口（只读治理发现）

`src/mcp/` 是 MCP（JSON-RPC 2.0 over HTTP）**服务端**，暴露十八个只读工具：`portico_list`、`portico_describe`、`portico_entry`、`portico_mcp`、`portico_web`、`portico_cli`、`portico_dashboard`、`portico_audit`、`portico_approvals`、`portico_identities`、`portico_grants`、`portico_revokes`、`portico_whoami`、`portico_sessions`、`portico_credentials`、`portico_credential_revokes`、`portico_gateway_audit`、`portico_page`。每个工具都是 `CatalogService` / `AuditService` / `AccessService` / `PageService` / `GatewayService` 已有调用的薄投影，因此可见性、审批与角色规则不会分叉——同一身份在 MCP、CLI、Portal 上看到的是同一批记录、同一顺序。工具结果是 CLI 同一个 `{ok,data}` / `{ok,error:{code,message}}` 信封，所以"三入口一致"可以靠比对载荷验证，而不是靠读三份实现。鉴权**只认会话**（`Authorization: Bearer` / `X-Portico-Session`）：网络调用者不得靠自称头证明身份。协议层错误（未知方法 `-32601`、未知工具 `-32602`、批量请求 `-32600`、解析失败 `-32700`）与工具层失败（in-band `isError`）分开；非 POST 返回 405。`portico_audit` 仍只对人类审计者开放；`portico_approvals` 对已登录身份开放、匿名得到空列表；`portico_identities` 对维护者与人类审计者开放，只读与匿名 FORBIDDEN；`portico_grants` 仅人类审计者，维护者/只读/匿名 FORBIDDEN；`portico_revokes` 仅人类审计者，维护者/只读/匿名 FORBIDDEN；`portico_whoami` 对已登录身份开放、匿名 FORBIDDEN；`portico_sessions` 仅人类审计者，维护者/只读/匿名 FORBIDDEN；`portico_credentials` 仅人类审计者，维护者/只读/匿名 FORBIDDEN；`portico_credential_revokes` 仅人类审计者，维护者/只读/匿名 FORBIDDEN；`portico_gateway_audit` 仅人类审计者，维护者/只读/匿名 FORBIDDEN；`portico_web` 对匿名与已登录身份开放，内部 Web 对匿名不可见；`portico_cli` 对匿名与已登录身份开放，内部 CLI 对匿名不可见；`portico_page` 对匿名与已登录身份开放，内部卡片对匿名不可见。MCP 进程只读（无 `--allow-write`），不执行、不代理、不编排任何外部工具。

- Web 渠道登记与已授权入口

维护者可登记 `channels=["web"]` 且 `entry.kind=url` 的外部 Web 入口。URL 必须是绝对 http(s)，禁止 userinfo、查询串密钥、`javascript:` 及其它非 http(s) 方案。路径不得是 Portico 自己的阅读页（`/s/<id>` 或 `/public/s/<id>`，含尾斜杠与查询串），避免把目录卡链回自身详情。`web list` / `web describe`、Portal `GET /api/web` 与 MCP `portico_web` 对同一身份返回 `{href, connect:{mode:"direct"}}`，由客户端直连；Portico 不抓取、不代理、不渲染远程页面。可见性与目录相同：内部对匿名不可见，公开须审批。CLI / MCP 表面不会出现在 Web 列表。失败登记不写目录。Portal HTML 只给当前身份可见的记录展示入口，并对 href 做 HTML 转义。

- CLI 渠道登记与已授权包坐标

维护者可登记 `channels=["cli"]` 且 `entry.kind=package` 的包坐标。坐标必须是 `jsr:@scope/name` 或 `npm:name` / `npm:@scope/name`（可带精确版本后缀），禁止命令、空白、shell 元字符、http(s)/git URL 及其它 registry。`cli list` / `cli describe`、Portal `GET /api/cli` 与 MCP `portico_cli` 对同一身份返回 `{package, connect:{mode:"coordinate"}}`；Portico 不安装、不执行、不下载该包。可见性与目录相同：内部对匿名不可见，公开须审批。MCP / Web 表面不会出现在 CLI 列表。失败登记不写目录。Portal HTML 把包坐标当转义后的代码展示，不当成可点击下载链接。

- MCP Gateway 鉴权与路由（门卫）

`src/gateway/` 对已登记 MCP 做身份、可见性与访问审计，再发出直连路由。`gateway authorize` 与 `POST /gateway/mcp/:id/authorize` 对同一身份返回 `{endpoint, connect:{mode:"direct"}}`；不转发 JSON-RPC、不执行工具、不代理流量。未授权或未审批公开得到 `NOT_FOUND`，响应不泄漏端点。允许与拒绝都追加到独立审计文件；人类审计者可 `gateway audit`、Portal `GET /api/gateway-audit`、MCP `portico_gateway_audit` 与 `GET /gateway/audit` 看到同一批记录，维护者不能读、也不能改写。工具调用类 POST 返回 405。默认绑定 `127.0.0.1`。失败授权不改目录。

- 人类安全审计视图

`src/audit/` 给人类审计者一条只读时间线。`audit list`、Portal `GET /api/audit` 与 MCP `portico_audit` 对同一身份合并同一份时间线：追加式目录变更（register / draft / publish / update）、身份授权、身份撤回、登录凭证作废、公开审批，以及 Gateway 访问审计。三处都读同一个可选 `PORTICO_GATEWAY_AUDIT_PATH`；`up` 会把它同时交给 Portal、MCP 与 Gateway，所以默认情况下三者呈现相同内容，而不是"CLI 有、其他入口没有"。`audit list` 接受 `--q` / `--kind` / `--action` / `--subject`，与 Portal `GET /api/audit`、MCP `portico_audit` 共用 `src/audit/query.ts`：过滤发生在审计者鉴权之后，只匹配 id / 主体 / 摘要 / 动作，不搜索入口 URL 或包坐标；非法过滤器 `INVALID_INPUT`，失败不写目录。维护者、只读者与匿名即使带过滤器也得到 `FORBIDDEN`；没有改写或删除入口。Portal `/internal/audit` 是无脚本 GET 表单，只给人类审计者。Portal 写方法仍 405，失败登记不写目录变更。审计结论与维护轨迹分开存储，维护者身份不能覆盖。

- UI Components 受约束门户组件

`src/ui/` 是固定种类的组件盒：`catalog_card`、`catalog_detail`、`permission_hint`、`approval_status`、`audit_snippet`。维护者可用 `page set` 把组件绑定到已有目录记录；`page get`、Portal `GET /api/page` / `GET /` 与 MCP `portico_page` 对同一身份解析。解析走目录可见性：内部与待审公开对匿名不可见，不能靠放进页面绕过审批。未知种类、HTML/主题字段、明文密钥被拒。`audit_snippet` 只对人类审计者填充。Portal 与 MCP 仍只读，POST `/api/page` 为 405。这不是 CMS、建站器或任意页面。

- 登录会话

人类审计者可 `identity credential issue` 一次性下发登录凭证；主体 `identity login` 换会话。凭证与会话只存 SHA-256，不落明文密钥或口令。CLI `--session` 与 Portal / Gateway `Authorization: Bearer`（或 `X-Portico-Session`）解析同一会话，角色始终从名册读取，不能靠会话头自封 auditor。失败登录不写会话；logout 后原令牌不可用。`--actor-*` 只能与 `--session` 同时出现且必须与之一致，单独出现被拒。Portal 仍无 `--allow-write`。这不是口令库，也不在 Portico 里跑 OAuth。

- 登录凭证作废

已签发的登录凭证与活动会话可由独立人类审计者 `identity credential revoke --id <subject>` 作废：该主体的未过期凭证和会话立即标 `revokedAt`（仍只存哈希），CLI `--session` 与 Portal / Gateway 会话头变为 `FORBIDDEN`；名册身份仍在，重新 `credential issue` + `login` 即可再次进入；目录记录不变。这与 `identity revoke` 不同：后者撤走主体；前者只切断登录面，主体留在名册中，可重新签发。切断登录面即切断 CLI / Gateway / MCP 与默认 Portal 会话路径。若 Portal 启用了 Cloudflare Access JWT 映射，名册上仍有 email 的人类身份仍可能经已校验 JWT 只读进入 Portal，直到 `identity revoke` 或关闭该功能。维护者、Agent、只读者与匿名得到 `FORBIDDEN`。未知主体 `NOT_FOUND`。没有活动凭证或会话、以及重复作废得到 `INVALID_STATE`。明文密钥字段被拒。作废审计记录**先写入**，随后才失效会话与凭证（与 `identity revoke` 同序）：`commitCredentialRevoke` 失败则什么都没发生，不会出现"会话已死但无记录"；若随后的失效步骤部分失败，调用方得到错误，重试可以补齐（主体仍有可作废的活动凭证可供重试）。反向顺序可能在"已无活动凭证"时失败，导致真实作废永久无记录且重试只会得到 `INVALID_STATE`。成功后审计者可重新 `credential issue`。作废轨迹进入人类安全审计视图（`kind=credential`），维护者不能读、不能改写。同一人类审计者经 CLI `identity credential revokes`、Portal `GET /api/credential-revokes` 与 MCP `portico_credential_revokes` 看到同一批追加式作废记录；读操作不改名册或会话文件。

- Portal 双平面 UI（内部笔记台 / 公开发布）

`src/portal/design/` 是页面层。同一套语义 token 支撑两个平面：内部笔记台（`/internal`、`/internal/c`、`/internal/pending`、`/internal/approvals`、`/internal/audit`、`/internal/s/:id`）面向只读及以上身份，呈治理状态、入口、维护者、待审公开队列、公开边界审批轨迹与治理路径；公开发布页（`/public`、`/public/t/:channel`、`/public/s/:id`）面向任何人，把已过审批的登记当作稿件呈现。公开发布页在视图层再筛一次，只渲染 `visibility=public` 且 `governanceState=approved_public` 的记录——即使请求者是维护者，草稿与待审公开也不进入公开页。颜色主题为四个固定预设（内部/公开 × 浅色/深色），解析顺序是 `?theme=` → 操作系统提示 → 平面默认；非法或跨平面取值静默降级。主题与模式是纯 CSS 属性，页面不含脚本、不引用远程字体或图片，CSP 仍为 `default-src 'none'`。审计路由只对人类审计者存在，其他身份得到 404。`/internal/pending` 给已登录身份看同一批可见的 `pending_public` 候选，可按 `?channel=`（cli / mcp / web）只读筛选，筛选 tab 显示该渠道待审计数（筛选后其它渠道计数不缩小；内部记录不计入），入口标明种类（url / package / mcp_endpoint），引用渲染为转义文本、不可点击，无脚本、无表单，不能批准或驳回；匿名仍 404，且不泄漏入口或渠道计数。未知 `channel` 静默忽略。`/internal/approvals` 给已登录身份（只读及以上）看同一批公开边界决定，匿名仍 404。`/` 是社论杂志风发现索引（渠道过滤、`/s/:id` 阅读栏），不是两个新平面的替代品。杂志壳只读链到 `/public`；已登录身份才链到 `/internal`，并把未过滤的 `pending_public` 计数链到 `/internal/pending`（不是批准入口）；匿名杂志壳不出现该入口。`/internal/c` 的「待审公开」计数同样链到待审队列。公开发布面链回 `/`，公开详情可链到同一条已审批记录的 `/s/:id`。规范见 [`ui-spec.md`](ui-spec.md)。

- Portal Cloudflare Access JWT 映射

`src/access/cf-access.ts` 用 Web Crypto 校验 RS256 JWT（`aud` / `iss` / `exp` / 签名）。默认关闭：`PORTICO_CF_ACCESS_ENABLED` 未显式打开，或缺少合法 team/aud 时，现有会话路径不变。启用后 Portal 在没有会话时读取 `Cf-Access-Jwt-Assertion`，用已校验 email 查名册人类身份；明文 `Cf-Access-Authenticated-User-Email` 不是证明。命中则与该身份的会话看到同一治理状态；失败为匿名（`/internal` HTML 404）。不写 `identities.json` / `sessions.json`，不签发 `pst1_` 会话。CLI / Gateway / MCP 不读该头。JWKS URL 只允许 loopback 测试地址或该 team 的 Cloudflare certs 路径。这不是 GitHub OAuth 客户端，也不托管 Tunnel。

- 尚未实现

GitHub OAuth / 邮箱 OTP 登录界面，以及 Cloudflare Tunnel / `cloudflared` 配置。它们属于边缘 IdP 与基础设施，不进本仓库。标为待核验以外的“已有能力”一律不应被写出。

## 目标功能清单

下列是目标画像中的一级业务能力，不是实现顺序，也不是当前事实。细节方案由执行者决定；边界以「非目标」为准。

### 1. Registry（目录）

登记 Agent 表面，而不是登记进程。一条记录至少能表达：身份、名称、说明、渠道（CLI / MCP / Web）、版本、可见性（内部 / 公开）、入口引用（URL、包坐标、MCP endpoint 等）、维护者（人与 Agent）、当前治理状态。

目录是唯一事实来源。Portal、CLI、MCP Gateway 只消费目录，不各写一份“谁已发布”。

### 2. Publisher（发布）

把登记从草稿变成内部或公开候选。内部发布按权限立即进入目录。公开发布只产生待审请求，不改变公开可达性。同一 Agent 可有多渠道，但渠道不能偷偷改变可见性。

### 3. Approval（公开审批）

公开是跨越组织信任边界的动作。审批必须独立于提交者：提交发布的 Agent 或用户不能自批。未通过、撤回、拒绝后，公开入口必须消失或保持不可达。审批记录保留：谁提交、谁审、审了什么、指向何处。

### 4. Portal（发现与仪表盘）

Web 入口用于浏览目录、查看治理状态、进入被授权的 Agent 表面。仪表盘默认回答治理问题（有什么、是否公开、待审多少、最近谁改了），不为 Agent 运行指标负责。

### 5. Access Control（分级权限）

类似传统 CMS 的分级，但身份分两类：人类与 Agent。至少能区分：只读、内部维护、提交公开、批准公开、安全审计。权限作用于可见性、发布、审批、组件/页面维护、审计日志。Agent 身份可维护，不可接管审计结论，不可批准自己的公开。

### 6. CLI

Portico 自己的命令行入口：登录/凭证、登记、发布、查询目录、看审批状态。任何命令一次调用内结束，成功与失败都可机读。CLI 发布的是**对 Portico 的操作**，不是在 Portico 里安装并运行第三方 Agent。

被登记的第三方 CLI 只是目录中的一种渠道引用，由外部提供。

### 7. MCP 渠道与 MCP Gateway

MCP 渠道：把外部 MCP Server 登记为可发现、可授权的入口。

MCP Gateway：站在门口做身份、权限、路由和访问审计。它不执行工具、不解释模型、不代跑 Agent。若某次实现无法安全代理流量，允许降级为“只发已授权的连接信息，由客户端直连”，但目录与权限仍以 Portico 为准。

### 8. UI Components（门户组件）

内置少量可组合的门户组件（目录卡、详情、权限提示、审批状态、审计片段等），让 Agent 能维护一致的门户页。组件盒的目的是可审计的一致性，不是通用 CMS 或可视化建站。

### 9. Agent 委派维护与人类安全审计

日常增改目录、元数据、门户页由 Agent 执行。人类只审安全：公开边界、入口指向、权限变化、密钥与凭据是否泄漏、网关是否越权。维护轨迹与审计结论分离存储；审计结论不能被维护者身份覆盖。

## 非目标（铁律）

- **不运行、编排、托管 Agent。** Portico 不是 runtime、不是队列、不是模型网关。原因：一旦代跑，门户变成机房，信任模型坍塌。
- **MCP Gateway 不执行工具、不代发推理。** 它只做门卫。原因：执行即运行时。
- **不做成通用 CMS / 建站系统 / 应用商店。** 没有内容类型工厂、主题市场、计费与交易。原因：那会把治理产品做成另一套 WordPress。
- **不绕过公开发布审批。** 任何入口（API、CLI、MCP、直接写库）都不能把未审批对象变成公开可达。
- **Agent 维护权 ≠ 安全审计权。** 维护者不能自批公开、不能删除或改写审计结论、不能关闭审计。
- **不在门户或日志中保存明文密钥。** 凭据只引用外部密钥设施或一次性下发。
- **不把 Portico 当成唯一制品仓库。** 包、镜像、源码仍在外部；这里管登记、可见性、授权与入口。
- **不为单个 Agent 的业务逻辑提供工作流引擎。** 那是 Agent 自己的事。
- **不使用 Node 作为运行时或工具链根基。** 原因：已选定 Deno；再引入 Node 会把权限模型与依赖图拆成两套。
- **不以 Bun 作为产品运行时，不引入第二运行时。** 原因：Bun 默认全开，和「人类只做安全审计」冲突；双运行时是熵增。某个原生模块在 Deno 上不可用，只允许隔离适配层，不允许升格为第二平台。

## 方向与意图

- 成为组织里 Agent 的唯一治理前门

服务于“能回答有什么、谁能用、是否公开”。没有第二份影子目录。

- 把内部与公开做成硬边界，而不是标签

服务于信任边界优先。公开失败必须比发布失败更显眼。

- 让 Agent 成为合法维护者，让人类成为审计者

服务于与传统 CMS 的本质差异。产品要默认 Agent 会写，人会审，而不是人填表。

- 三入口语义一致

Portal、CLI、MCP 看到同一可见性与同一审批状态。一个入口公开、另一个入口仍隐藏，视为缺陷。

- 网关保持门卫身份

服务于“不运行 Agent”。流量代理可以有，执行循环不能有。

- 组件盒保持小而硬

服务于可审计的门户一致性。组件变少可以，变成建站器不行。

- 单一 Deno 运行时，权限默拒

服务于信任边界与可审计性。L0 已锁定：不回到 Node，不把 Bun 升格为平台。

## 完成的样子

当下列可观察结果同时成立，这个项目才算做成门户，而不是又一个后台：

- 内部发布后，有权限者能在 Portal / CLI / MCP 发现同一条记录；无权限者不能。
- 公开发布在审批完成前，对匿名与组织外主体不可见、不可达；审批拒绝或撤回后保持如此。
- 提交公开的身份不能批准同一请求。
- 目录变更、权限变更、公开审批都留下不可被维护者改写的审计记录。
- 测试或探测无法通过 Portico 执行外部 Agent 的工具或推理。
- 进程不依赖 `node`；未在白名单中的 net/read/env 调用不能跑通。
- 核心治理数据流有自动化验证；回归能在 CI 被挡住。运行时侧用 Deno 的检查与测试（例如 `deno check` / `deno test` / `deno lint`）；一级业务功能仍须达到下方矩阵的覆盖底线。

## 验收矩阵（业务能力覆盖矩阵）

> 覆盖底线（硬性规定）：
>
> 1. 每个一级功能至少有一条 Happy Path E2E。
> 2. 每个高风险功能至少覆盖一条失败路径。
> 3. 每个涉及权限的功能至少验证两种角色。
> 4. 每个会修改系统状态的操作至少验证一次失败后的恢复或回滚。
> 5. 每次新增一级业务功能，必须同步新增对应的 E2E 并更新本矩阵。

Registry 内部登记、Publisher 草稿/内部发布/公开候选、Approval 通过/拒绝、公开发布撤回、Access Control 身份名册、身份名册只读查询、当前会话身份只读查询、登录会话只读查询、登录凭证只读查询、登录凭证作废轨迹只读查询、身份撤回轨迹只读查询、名册可选邮箱、身份授权撤回、登录会话、登录凭证作废、Portal 可选 Cloudflare Access JWT 映射、Portal 发现/仪表盘、Portal 双平面 UI 与颜色主题、目录过滤查询、审计时间线过滤查询、MCP 渠道登记/连接信息、Web 渠道登记/已授权入口、CLI 渠道登记/已授权包坐标、MCP Gateway 鉴权路由、人类安全审计视图、UI Components 门户页维护，以及 CLI 对应命令已有测试证据。邮箱仍不是第二身份证明。三个非匿名入口里，CLI / Gateway / MCP 仍只认会话：CLI `--session`，Gateway / MCP 的 `Authorization: Bearer` 或 `X-Portico-Session`。Portal 在默认关闭时同样只认会话；显式启用 Cloudflare Access 后，校验通过的 JWT 只映射名册，不签发会话。`--actor-*` 与 `X-Portico-Actor-*` 不构成证明，Portal / Gateway / MCP 已不接受，CLI 单独给出即拒绝。GitHub OAuth / 邮箱 OTP 界面与 Tunnel 仍是边缘基础设施，不在本仓库。

| 一级功能 | 风险级别 | Happy Path E2E | 失败路径 | 权限角色覆盖 | 失败恢复/回滚 | 证据（测试路径/用例） |
| --- | --- | --- | --- | --- | --- | --- |
| Registry 登记与目录 | 高 | ✅ 维护者登记内部表面，只读者 list/get 同一条 | ✅ 公开可见性被拒；偷写 `approved_public` 被拒；非法 id / 明文密钥字段被拒（含 URL 查询值、fragment、路径与包坐标，以及 name/description/version 里嵌入的密钥子串，含 AWS Access Key ID `AKIA`/`ASIA` 形值、Google API Key `AIza` 形值、PEM 私钥头与 npm 访问令牌 `npm_` 形值）；Web 入口指向自身阅读页 `/s/:id` 或 `/public/s/:id` 被拒 | ✅ 只读 vs 维护者；匿名看不到内部记录 | ✅ 失败不写 Memory/File 目录 | `tests/catalog_service_test.ts`；`tests/web_channel_test.ts`；`tests/e2e/cli_catalog_e2e_test.ts` |
| Registry 受治理表面更新 | 高 | ✅ 维护者 `catalog update` 改 `internal`/`draft` 记录的 name/description/version/channels/entry；reader 看到同一条更新 | ✅ 待审 `pending_public` 与已公开 `approved_public` 记录更新被拒（`INVALID_STATE`）；`rejected` 记录可更新（拒绝→修改→重新提交这条路径必须成立）；reader/匿名更新 `FORBIDDEN`；未知字段/明文密钥（含 name/description/version 内嵌的密钥子串，含 AWS Access Key ID `AKIA`/`ASIA` 形值、Google API Key `AIza` 形值、PEM 私钥头与 npm 访问令牌 `npm_` 形值）/空更新被拒；渠道与入口不一致被拒；把 web entry 改成自身阅读页被拒 | ✅ 维护者 vs 只读/匿名 | ✅ 失败更新不改目录文件字节；已公开记录须先 `withdraw`，被拒记录改后须重新 `publish`+`approve` 才能公开可见（重新提交只回到待审） | `tests/catalog_update_test.ts`；`tests/web_channel_test.ts`；`tests/e2e/cli_update_e2e_test.ts` |
| Publisher 内部发布 | 高 | ✅ 草稿对只读隐藏；`publish --visibility internal` 后只读者可见同一条 | ✅ 无权 draft/publish 被拒；偷写 `approved_public`/明文密钥被拒；不能把 pending_public 降回 internal | ✅ 维护者 vs 只读；匿名看不到公开候选 | ✅ 失败不写/不改目录；公开候选对匿名仍不可达 | `tests/catalog_publisher_test.ts`；`tests/e2e/cli_publish_e2e_test.ts` |
| Approval 公开发布审批 | 高 | ✅ 独立人类审计者 approve（可带 `--note`）后匿名 list/get 同一条 `approved_public`；只读者在三入口看到同一条含 note 的审批记录；入口是公网主机名（含 `10.1.2.3.docs.example.com` 这类形似数字的公开域名、2000::/3 全局单播 IPv6）时 approve 成功 | ✅ 自批 SELF_APPROVAL（带 note 也不写）；维护者/Agent/只读 FORBIDDEN；拒绝后匿名仍不可见；密钥字段被拒；空白/过长/控制字符 note `INVALID_INPUT`；入口只在网内可达（RFC1918、回环、链路本地、单标签主机名；非 2000::/3 全局单播的 IPv6，含 ULA、链路本地、已废弃 site-local、IPv4-mapped）时 `INVALID_STATE`，不把内网拓扑带到公开面 | ✅ 提交者 vs 人类审计者；维护者不能审；只读者可读备注、匿名不能 | ✅ 失败不写审批记录、不改公开面；非法 note 不改 catalog 文件字节；已拒绝不能再 reject 改写；内网入口候选经 reject→update→publish→approve 修复后可公开，id 不被毒化；内部记录仍可携带内网入口（只在跨界时拒绝） | `tests/catalog_approval_test.ts`；`tests/e2e/cli_approval_e2e_test.ts`；`tests/e2e/catalog_approvals_e2e_test.ts` |
| 公开审批记录只读查询 | 高 | ✅ 同一已登录身份经 CLI `catalog approvals`、Portal `GET /api/approvals` 与 MCP `portico_approvals` 得到同一批通过/拒绝/撤回记录（含可选 `note`）与同一顺序；Portal `/internal/approvals` 无脚本 HTML 对只读/维护者/审计者呈现同一批记录与备注 | ✅ 匿名得到空列表且不泄漏待审、已拒绝入口或备注；匿名 `/internal/approvals` HTML 404 且不泄漏名称或备注；待审候选不出现在审批页；Portal POST `/api/approvals` 405；载荷不含凭证或会话令牌；备注 HTML 转义 | ✅ 已登录（审计者/维护者/只读）vs 匿名 | ✅ 读审批记录不改 catalog 文件字节；失败 POST 不追加审批记录；Portal / MCP 只读入口无 `--allow-write` | `tests/catalog_approval_test.ts`；`tests/portal_handler_test.ts`；`tests/portal_ui_test.ts`；`tests/mcp_protocol_test.ts`；`tests/e2e/catalog_approvals_e2e_test.ts`；`tests/e2e/portal_ui_e2e_test.ts` |
| 公开发布撤回 | 高 | ✅ 人类审计者 `catalog withdraw --id`（可带 `--note`）后，匿名在 CLI `list`/`get`、Portal `/api/catalog` 与 `/api/mcp`、Gateway authorize 上同时不可达；只读者仍见同一条 `internal`，并在三入口看到 withdrawn 记录上的 note | ✅ 维护者/Agent/只读者/匿名撤回 FORBIDDEN；未知 id NOT_FOUND；对 `internal`/`pending_public`/`rejected` 与重复撤回 INVALID_STATE；密钥字段被拒；非法 note 不撤回 | ✅ 人类审计者 vs 维护者/Agent/只读者/匿名 | ✅ 失败撤回不改目录文件字节、不追加审批记录，公开面仍 `approved_public`；撤回后重发只回 `pending_public`，须重新独立审批才能再公开 | `tests/catalog_withdraw_test.ts`；`tests/e2e/cli_withdrawal_e2e_test.ts` |
| Portal 发现与仪表盘 | 中 | ✅ CLI register 后 reader 在 Portal list/HTML 与 `/s/:id` 看到同一条；approve 后匿名在 hero/list/详情看到同一条 `approved_public`；同一身份经 CLI `catalog dashboard`、Portal `GET /api/dashboard` 与 MCP `portico_dashboard` 得到同一计数与同一顺序；无 `channel` 的详情页顶栏不默认 Web，「内容」高亮；阅读页只保留一组渠道入口且回到带筛选的列表；渠道展示名来自 `CHANNEL_LABEL`；面包屑渠道层链到带筛选的列表；`q` 透传到左栏渠道入口、面包屑首页与面包屑渠道层；可见记录上不匹配的 `channel`/`q` 会 302 到自身渠道（`q` 仍命中则保留），规范化后再渲染时列表包含选中记录；杂志壳链到 `/public`，已登录身份另链到 `/internal`，并把未过滤的 `pending_public` 计数链到 `/internal/pending`（`q`/`channel` 过滤不缩小该计数）；公开发布面链回杂志 `/`，公开详情链到同一条 `/s/:id`；阅读页「返回列表」保留 `channel`/`q` | ✅ 内部与 pending_public 对匿名不可见；渠道过滤不泄漏匿名不可见记录；内部详情对匿名 HTML 404 且不泄漏入口；匿名带错误 `channel` 访问内部详情仍 404、Location 不泄漏；匿名杂志壳与公开面都不出现 `/internal` 或 `/internal/pending`；匿名 `/internal` 仍 404；POST 405；冒充 auditor FORBIDDEN；HTML 转义名称；缺 `--catalog` 的 dashboard 为 `USAGE` | ✅ reader vs 匿名 | ✅ 失败写不改 catalog 文件；读 dashboard 不改目录字节；阅读页筛选规范化不改目录字节；跨面导航是只读链接，不改目录字节；只读入口无 `--allow-write` | `tests/portal_handler_test.ts`；`tests/portal_magazine_test.ts`；`tests/portal_ui_test.ts`；`tests/catalog_dashboard_test.ts`；`tests/e2e/portal_discovery_e2e_test.ts`；`tests/e2e/portal_magazine_e2e_test.ts`；`tests/e2e/catalog_dashboard_e2e_test.ts` |
| 目录过滤查询 | 中 | ✅ 同一身份经 CLI `catalog list --q`、Portal `GET /api/catalog?q=` 与 MCP `portico_list` 得到同一批过滤结果与同一顺序；杂志 `GET /?q=` 是无脚本 GET 表单，只展示已授权表面 | ✅ 匿名 q 匹配内部记录为空且不泄漏入口/包坐标；q 不搜索 endpoint 或 `jsr:`/`npm:` 坐标；非法 channel / 过长 q / 控制字符 `INVALID_INPUT` | ✅ reader vs 匿名 | ✅ 非法查询不改 catalog 文件字节；Portal / MCP 只读入口无 `--allow-write` | `tests/catalog_query_test.ts`；`tests/portal_handler_test.ts`；`tests/portal_magazine_test.ts`；`tests/mcp_protocol_test.ts`；`tests/e2e/cli_catalog_e2e_test.ts`；`tests/e2e/catalog_query_e2e_test.ts`；`tests/e2e/portal_magazine_e2e_test.ts` |
| Portal 双平面 UI 与颜色主题 | 中 | ✅ 维护者在 `/internal` 看到草稿、待审与内部记录；同一批数据在 `/public` 只呈现 `approved_public`；已登录身份在 `/internal/pending` 看到同一批可见的 `pending_public` 候选，可按 `?channel=`（cli / mcp / web）只读筛选，筛选 tab 显示该渠道待审计数（筛选后其它渠道计数不缩小；内部记录不计入），入口标明种类（url / package / mcp_endpoint）、引用为转义文本、不可点击；`/internal/c` 的「待审公开」计数链到该队列；已登录身份在 `/internal/approvals` 看到同一批公开边界决定（含备注）；四个主题预设各自渲染，`?theme=` 切换生效 | ✅ 匿名访问 `/internal*` 全部 HTML 404（非 JSON）且不泄漏记录；非审计者 `/internal/audit` HTML 404；匿名 `/internal/pending` 与 `/internal/approvals` HTML 404 且不泄漏名称、备注、待审入口或渠道计数；待审队列不含草稿/内部/已公开名称、无表单按钮、入口不是 href；渠道筛选后其它渠道候选不出现，但 tab 仍显示未筛选的待审计数；未知 `channel` 静默忽略；目录看板待审链接不是批准入口；未审批记录的 `/public/s/:id` HTML 404；撤回后公开页与文章同时消失；未知或跨平面 `?theme=` 静默降级；页面不含 script / inline handler / `javascript:` | ✅ 匿名 / reader / maintainer / human auditor 四种身份在公开页与审计面上结果不同；待审队列与审批页对已登录开放、对匿名 404；只读与审计者均可按渠道筛选待审队列并看到同一批渠道待审计数 | ✅ 撤回与拒绝后公开面立即不可达且不脏写；读 `/internal/pending`（含 `?channel=`）与 `/internal/approvals` 不改 catalog 文件字节；主题解析失败不改目录、不返回 500 | `tests/portal_ui_test.ts`；`tests/portal_theme_test.ts`；`tests/e2e/portal_ui_e2e_test.ts` |
| Access Control 分级权限 | 高 | ✅ 审计者授予 Agent 维护者后，维护者 register、只读者 list 同一条 | ✅ 维护者自封 auditor FORBIDDEN；Agent 不能被授予 auditor；未知身份不能 register | ✅ 人类审计者 vs Agent 维护者；只读者不能 list 名册 | ✅ 失败 grant 不改 identities/grants；失败 approve 不改公开面 | `tests/access_service_test.ts`；`tests/e2e/cli_access_e2e_test.ts` |
| 身份名册只读查询 | 高 | ✅ 同一维护者经 CLI `identity list`、Portal `GET /api/identities` 与 MCP `portico_identities` 得到同一批 `{id,kind,role}`（有邮箱时含 `email`）与同一顺序；人类审计者看到同一载荷 | ✅ 只读者与匿名 FORBIDDEN；载荷不含 secretHash / token / 会话令牌；磁盘上的未知字段不会出现在列表里 | ✅ 维护者/人类审计者 vs 只读/匿名 | ✅ 读名册不改 identities.json 与 catalog 文件字节；Portal / MCP 只读入口无 `--allow-write` | `tests/access_service_test.ts`；`tests/portal_handler_test.ts`；`tests/mcp_protocol_test.ts`；`tests/e2e/identity_roster_e2e_test.ts` |
| 授权轨迹只读查询 | 高 | ✅ 同一人类审计者经 CLI `identity grants`、Portal `GET /api/grants` 与 MCP `portico_grants` 得到同一批追加式授权记录与同一顺序 | ✅ 维护者/只读/匿名 FORBIDDEN；Portal POST `/api/grants` 405；载荷不含凭证或会话令牌 | ✅ 人类审计者 vs 维护者/只读/匿名 | ✅ 读授权轨迹不改 identities.json 与 catalog 文件字节；失败 POST 不追加 grant；Portal / MCP 只读入口无 `--allow-write` | `tests/access_service_test.ts`；`tests/portal_handler_test.ts`；`tests/mcp_protocol_test.ts`；`tests/e2e/identity_grants_e2e_test.ts` |
| 身份撤回轨迹只读查询 | 高 | ✅ 同一人类审计者经 CLI `identity revokes`、Portal `GET /api/revokes` 与 MCP `portico_revokes` 得到同一批追加式撤回记录与同一顺序 | ✅ 维护者/只读/匿名 FORBIDDEN；Portal POST `/api/revokes` 405；载荷不含凭证或会话令牌；磁盘未知字段不出现在列表 | ✅ 人类审计者 vs 维护者/只读/匿名 | ✅ 读撤回轨迹不改 identities.json 与 catalog 文件字节；失败 POST 不追加 revoke；Portal / MCP 只读入口无 `--allow-write` | `tests/access_revoke_test.ts`；`tests/portal_handler_test.ts`；`tests/mcp_protocol_test.ts`；`tests/e2e/identity_revokes_e2e_test.ts` |
| 当前会话身份只读查询 | 高 | ✅ 同一已登录身份经 CLI `identity whoami`、Portal `GET /api/whoami` 与 MCP `portico_whoami` 得到同一 `{id,kind,role}` | ✅ 匿名 Portal / MCP `FORBIDDEN`；CLI 缺会话 `USAGE`；Portal POST `/api/whoami` 405；载荷不含邮箱、凭证或会话令牌 | ✅ 已登录（审计者/维护者/只读）vs 匿名 | ✅ 读 whoami 不改 identities.json 与 catalog 文件字节；失败 POST 不写名册；Portal / MCP 只读入口无 `--allow-write` | `tests/access_service_test.ts`；`tests/portal_handler_test.ts`；`tests/mcp_protocol_test.ts`；`tests/e2e/identity_whoami_e2e_test.ts` |
| 登录会话只读查询 | 高 | ✅ 同一人类审计者经 CLI `identity sessions`、Portal `GET /api/sessions` 与 MCP `portico_sessions` 得到同一批会话轨迹（id / subjectId / createdAt / expiresAt，作废则含 revokedAt）与同一顺序 | ✅ 维护者/只读/匿名 FORBIDDEN；CLI 缺 `--sessions` `USAGE`；Portal POST `/api/sessions` 405；载荷不含令牌或哈希 | ✅ 人类审计者 vs 维护者/只读/匿名 | ✅ 读会话轨迹不改 sessions.json、identities.json 与 catalog 文件字节；失败 POST 不签发/不作废会话；Portal / MCP 只读入口无 `--allow-write` | `tests/access_session_test.ts`；`tests/portal_handler_test.ts`；`tests/mcp_protocol_test.ts`；`tests/e2e/identity_sessions_e2e_test.ts` |
| 登录凭证只读查询 | 高 | ✅ 同一人类审计者经 CLI `identity credentials`、Portal `GET /api/credentials` 与 MCP `portico_credentials` 得到同一批凭证轨迹（id / subjectId / credentialRef / issuedBy / issuedAt，作废则含 revokedAt）与同一顺序 | ✅ 维护者/只读/匿名 FORBIDDEN；CLI 缺 `--sessions` `USAGE`；Portal POST `/api/credentials` 405；载荷不含令牌或哈希 | ✅ 人类审计者 vs 维护者/只读/匿名 | ✅ 读凭证轨迹不改 sessions.json、identities.json 与 catalog 文件字节；失败 POST 不签发/不作废凭证；Portal / MCP 只读入口无 `--allow-write` | `tests/access_session_test.ts`；`tests/portal_handler_test.ts`；`tests/mcp_protocol_test.ts`；`tests/e2e/identity_credentials_e2e_test.ts` |
| 登录凭证作废轨迹只读查询 | 高 | ✅ 同一人类审计者经 CLI `identity credential revokes`、Portal `GET /api/credential-revokes` 与 MCP `portico_credential_revokes` 得到同一批追加式作废记录与同一顺序 | ✅ 维护者/只读/匿名 FORBIDDEN；Portal POST `/api/credential-revokes` 405；载荷不含凭证或会话令牌；磁盘未知字段不出现在列表 | ✅ 人类审计者 vs 维护者/只读/匿名 | ✅ 读作废轨迹不改 identities.json、sessions.json 与 catalog 文件字节；失败 POST 不追加 credential revoke；Portal / MCP 只读入口无 `--allow-write` | `tests/access_credential_revoke_test.ts`；`tests/portal_handler_test.ts`；`tests/mcp_protocol_test.ts`；`tests/e2e/identity_credential_revokes_e2e_test.ts` |
| 名册可选邮箱 | 高 | ✅ 人类审计者 `identity grant --email` 给人类身份绑定唯一地址；同一维护者经 CLI `identity list`、Portal `GET /api/identities` 与 MCP `portico_identities` 看到同一规范化 email | ✅ Agent 带 email `INVALID_INPUT`；非法或重复邮箱 `INVALID_INPUT`；只读/匿名仍 FORBIDDEN；密钥字段被拒 | ✅ 人类审计者可写 vs 维护者只读 vs 只读/匿名不可见名册 | ✅ 失败 grant 不改 identities 文件字节；省略 email 的再次 grant 保留已绑定地址 | `tests/access_service_test.ts`；`tests/e2e/identity_roster_e2e_test.ts` |
| 身份授权撤回 | 高 | ✅ 人类审计者 `identity revoke --id` 后，被撤维护者不能再 register；只读者仍见其留下的目录记录；`audit list` 出现 `revoke` | ✅ 维护者/Agent/只读 FORBIDDEN；自撤 FORBIDDEN；最后一位人类审计者 INVALID_STATE；未知或重复撤回 NOT_FOUND；密钥字段被拒 | ✅ 人类审计者 vs 维护者；被撤主体 vs 仍在名册的只读者 | ✅ 失败撤回不改 identities 文件字节、不追加 revoke、不作废会话/凭证；成功撤回后原 session 立即 FORBIDDEN | `tests/access_revoke_test.ts`；`tests/audit_service_test.ts`；`tests/e2e/cli_identity_revoke_e2e_test.ts` |
| 登录会话 | 高 | ✅ 审计者一次性下发凭证；主体 login 后 CLI `--session` list 与 Portal 会话头看到同一条内部记录 | ✅ 错误 token 登录 FORBIDDEN；会话上伪造 auditor 头 FORBIDDEN；无效 session 不能 approve | ✅ 只读 session 不能 register；维护者 session 不能审公开 | ✅ 失败登录不写 session 记录；logout 后原令牌不可用且不改 catalog | `tests/access_session_test.ts`；`tests/e2e/cli_session_e2e_test.ts`；`tests/e2e/portal_session_e2e_test.ts` |
| Portal Cloudflare Access JWT 映射 | 高 | ✅ 显式启用后，合法 RS256 JWT（aud/iss/exp 通过）且名册 email 命中时，Portal `/api/catalog` 与 `/internal` 与该人类会话看到同一内部记录 | ✅ 伪造签名、过期、AUD 不匹配、名册未登记、明文 `Cf-Access-Authenticated-User-Email` 头全部匿名（`/internal` HTML 404）；未启用时 JWT 被忽略；Gateway 不接受该 JWT | ✅ 映射后的只读者不能读 `/api/audit`；匿名/失败 JWT 看不到内部记录 | ✅ 成功或失败都不写 identities/sessions 文件字节；不签发 Portico 会话 | `tests/access_cf_access_test.ts`；`tests/portal_handler_test.ts`；`tests/gateway_handler_test.ts`；`tests/e2e/portal_cf_access_e2e_test.ts` |
| 身份证明与信任根 | 高 | ✅ 会话可完成各自角色的操作：审计者 approve、维护者 register、只读者 list 同一条；空名册 bootstrap 签发首张凭证后 login 成功 | ✅ `--actor-*` 单独出现被拒且不写文件；Portal / MCP 伪造 `X-Portico-Actor-*` 只得到匿名视图（审计面 403）；非审计者会话 approve FORBIDDEN；首个凭证签发后再次无会话 `credential issue` FORBIDDEN；非人类审计者 bootstrap FORBIDDEN | ✅ 匿名 / 只读 / 维护者 / 人类审计者四种会话；伪造头 vs 真会话 | ✅ 被拒的冒名不写 identities/catalog/approvals；bootstrap 被拒不改 sessions 文件 | `tests/e2e/cli_access_e2e_test.ts`；`tests/portal_handler_test.ts`；`tests/mcp_protocol_test.ts`；`tests/e2e/portal_session_e2e_test.ts`；`tests/e2e/cli_session_e2e_test.ts` |
| 登录凭证作废 | 高 | ✅ 人类审计者 `identity credential revoke --id` 后，原 login token 与 `--session` / Portal 会话头立即 FORBIDDEN；名册仍有该身份，重新 `credential issue` + `login` 后仍能 list 同一条内部记录；`audit list` 出现 `revoke_credential` | ✅ 维护者/只读/匿名 FORBIDDEN；未知主体 NOT_FOUND；无活动凭证/会话与重复作废 INVALID_STATE；密钥字段被拒 | ✅ 人类审计者 vs 维护者；被作废主体 vs 重新签发后的同一主体 | ✅ 审计记录先写、失效后做：`commitCredentialRevoke` 失败则 sessions/credentials 文件字节不变；部分失败可重试补齐；成功后可重新 issue 新凭证 | `tests/access_credential_revoke_test.ts`；`tests/audit_service_test.ts`；`tests/e2e/cli_credential_revoke_e2e_test.ts` |
| CLI 发布与查询 | 高 | ✅ `identity grant` 后 `catalog register`，reader `list`/`get`；`draft`→`publish internal` 后 reader 可见；`approve` 后匿名可见 | ✅ reader 登记/draft/publish FORBIDDEN；公开登记 PUBLIC_REQUIRES_APPROVAL；公开 publish 后匿名 list 为空；自批/维护者 approve 失败；未授权身份 FORBIDDEN | ✅ 维护者 vs 只读 vs 人类审计者；匿名看不到内部、待审与审批记录 | ✅ 失败不创建/不改 catalog 文件、approvals 与 identities | `tests/e2e/cli_catalog_e2e_test.ts`；`tests/e2e/cli_publish_e2e_test.ts`；`tests/e2e/cli_approval_e2e_test.ts`；`tests/e2e/cli_access_e2e_test.ts` |
| MCP 渠道登记与访问 | 高 | ✅ 维护者登记 mcp_endpoint；同一只读者经 CLI `mcp list`、Portal `GET /api/mcp` 与 MCP `portico_mcp` 得到同一批连接信息与同一顺序；`mcp describe` / `/api/mcp/:id` 仍是单条；approve 后匿名在三入口看到同一条 `approved_public` 且 `connect.mode=direct` | ✅ 密钥查询名/查询值/fragment/userinfo/命令式入口被拒；CLI 表面不出现在 MCP 列表；匿名看不到内部 MCP；未审批公开 MCP 对匿名不可达；Portal POST `/api/mcp` 405 | ✅ 只读 vs 匿名；维护者可登记、只读者可描述 | ✅ 失败登记不写 catalog 文件；读列表不改目录字节；Portal POST `/api/mcp` 不改目录；Portal / MCP 只读入口无 `--allow-write` | `tests/mcp_channel_test.ts`；`tests/mcp_protocol_test.ts`；`tests/e2e/cli_mcp_e2e_test.ts`；`tests/e2e/portal_mcp_e2e_test.ts`；`tests/e2e/mcp_list_e2e_test.ts`；`tests/portal_handler_test.ts` |
| MCP 协议入口（只读治理发现） | 高 | ✅ 同一身份经 CLI `catalog list`、Portal `GET /api/catalog` 与 MCP `portico_list` 得到同一批记录与同一顺序；匿名经 Portal 与 MCP 都只看到 `approved_public` 且严格少于只读者 | ✅ 伪造 `X-Portico-Actor-*` 头不产生审计者身份（`portico_audit` 仍 FORBIDDEN）；非审计者 `portico_audit` FORBIDDEN；未知方法 `-32601`；未知工具 `-32602`；批量请求 `-32600`；非法 channel/state 过滤 `INVALID_INPUT`；非 POST 405 | ✅ 匿名 vs 只读会话；人类审计者 vs 其他角色 | ✅ 工具失败只回 in-band `{ok:false,error}`，不改目录、不追加审计；MCP 进程无 `--allow-write`；`up` 停止后端口关闭 | `tests/mcp_protocol_test.ts`；`tests/e2e/mcp_http_e2e_test.ts`；`tests/e2e/entrypoint_boot_e2e_test.ts`；`tests/e2e/system_up_e2e_test.ts` |
| Web 渠道登记与已授权入口 | 高 | ✅ 维护者登记 url；同一只读者经 CLI `web list`、Portal `GET /api/web` 与 MCP `portico_web` 得到同一批连接信息与同一顺序；`web describe` / `/api/web/:id` 仍是单条；approve 后匿名在三入口看到同一条 `approved_public` 且 `connect.mode=direct` | ✅ 密钥查询名/查询值/fragment/userinfo/`javascript:` 入口被拒；指向 Portico 自身 `/s/:id` 或 `/public/s/:id` 阅读页的 url 被拒；CLI 与 MCP 表面不出现在 Web 列表；匿名看不到内部 Web；未审批公开 Web 对匿名不可达；Portal POST `/api/web` 405 | ✅ 只读 vs 匿名；维护者可登记、只读者可描述 | ✅ 失败登记不写 catalog 文件；失败更新不改目录文件字节；读列表不改目录字节；Portal POST `/api/web` 不改目录；Portal / MCP 只读入口无 `--allow-write` | `tests/web_channel_test.ts`；`tests/catalog_update_test.ts`；`tests/mcp_protocol_test.ts`；`tests/e2e/cli_web_e2e_test.ts`；`tests/e2e/portal_web_e2e_test.ts`；`tests/e2e/web_list_e2e_test.ts`；`tests/portal_handler_test.ts` |
| CLI 渠道登记与已授权包坐标 | 高 | ✅ 维护者登记 package；同一只读者经 CLI `cli list`、Portal `GET /api/cli` 与 MCP `portico_cli` 得到同一批包坐标与同一顺序；`cli describe` / `/api/cli/:id` 仍是单条；approve 后匿名在三入口看到同一条 `approved_public` 且 `connect.mode=coordinate` | ✅ 命令式/`npx`/URL/未知 registry/密钥形值坐标（scope 或 name 段嵌入的密钥子串）被拒；MCP/Web 表面不出现在 CLI 列表；匿名看不到内部包坐标；未审批公开 CLI 对匿名不可达；Portal POST `/api/cli` 405 | ✅ 只读 vs 匿名；维护者可登记、只读者可描述 | ✅ 失败登记不写 catalog 文件；读列表不改目录字节；Portal POST `/api/cli` 不改目录；Portal / MCP 只读入口无 `--allow-write` | `tests/cli_channel_test.ts`；`tests/mcp_protocol_test.ts`；`tests/e2e/cli_package_e2e_test.ts`；`tests/e2e/portal_cli_e2e_test.ts`；`tests/e2e/cli_list_e2e_test.ts`；`tests/portal_handler_test.ts` |
| MCP Gateway 鉴权与路由 | 高 | ✅ 维护者登记 MCP 后，只读者 `gateway authorize` 与 HTTP `POST /gateway/mcp/:id/authorize` 得到同一 `connect.mode=direct` 路由；审计者可读到 allowed 记录 | ✅ 匿名内部/待审公开 NOT_FOUND 且不泄漏端点；CLI 表面不可授权；`tools/call` 返回 405 且不执行 | ✅ 已授权 reader vs 匿名；维护者不能读审计 | ✅ 失败授权不改 catalog 文件；拒绝工具调用不脏写目录 | `tests/gateway_service_test.ts`；`tests/gateway_handler_test.ts`；`tests/e2e/cli_gateway_e2e_test.ts`；`tests/e2e/gateway_http_e2e_test.ts` |
| Gateway 访问审计只读查询 | 高 | ✅ 同一人类审计者经 CLI `gateway audit`、Portal `GET /api/gateway-audit` 与 MCP `portico_gateway_audit` 得到同一批允许/拒绝记录与同一顺序 | ✅ 维护者/只读/匿名 FORBIDDEN；Portal POST `/api/gateway-audit` 405；载荷不含凭证或会话令牌；未配置 Gateway 时审计者得到空列表且其他人仍 FORBIDDEN | ✅ 人类审计者 vs 维护者/只读/匿名 | ✅ 读访问审计不改 catalog 文件与 gateway-audit 文件字节；失败 POST 不追加授权记录；Portal / MCP 只读入口无 `--allow-write` | `tests/gateway_service_test.ts`；`tests/portal_handler_test.ts`；`tests/mcp_protocol_test.ts`；`tests/e2e/gateway_audit_e2e_test.ts` |
| UI Components 门户页维护 | 中 | ✅ 维护者 `page set` 组合 catalog_card；同一只读者经 CLI `page get`、Portal `GET /api/page` 与 MCP `portico_page` 看到同一张卡与同一顺序 | ✅ 未知种类/HTML/密钥字段被拒；内部卡对匿名不可见；待审公开仍不可达；Portal POST `/api/page` 405 | ✅ 维护者 vs 只读；匿名看不到未审批引用 | ✅ 失败 set 不写 page 文件；读 page 不改 page/catalog 字节；Portal POST `/api/page` 405 且不改 page/catalog；Portal / MCP 只读入口无 `--allow-write` | `tests/ui_page_test.ts`；`tests/portal_page_handler_test.ts`；`tests/mcp_protocol_test.ts`；`tests/e2e/cli_page_e2e_test.ts`；`tests/e2e/portal_page_e2e_test.ts`；`tests/e2e/page_get_e2e_test.ts` |
| Agent 维护与人类安全审计 | 高 | ✅ 维护者登记并提交公开后，人类审计者 `audit list`、Portal `GET /api/audit` 与 MCP `portico_audit` 看到同一条目录变更、授权、撤回与审批时间线；配置 `PORTICO_GATEWAY_AUDIT_PATH` 后三处都并入 Gateway 访问事件 | ✅ 维护者/只读/匿名 FORBIDDEN；Portal PATCH/POST `/api/audit` 405；失败公开登记不出现 catalog 事件 | ✅ 维护 Agent vs 人类审计者；维护者不能读、不能改写 | ✅ 失败登记不写 catalog 文件与变更日志；读审计不改授权/审批记录 | `tests/catalog_change_test.ts`；`tests/audit_service_test.ts`；`tests/portal_handler_test.ts`；`tests/e2e/cli_audit_e2e_test.ts`；`tests/e2e/portal_audit_e2e_test.ts` |
| 审计时间线过滤查询 | 高 | ✅ 同一人类审计者经 CLI `audit list --kind/--q`、Portal `GET /api/audit?kind=&q=` 与 MCP `portico_audit` 得到同一批过滤结果与同一顺序；`/internal/audit` 是无脚本 GET 表单，只展示匹配事件 | ✅ 维护者/只读/匿名带过滤器仍 FORBIDDEN；q 不搜索入口 URL 或包坐标；非法 kind / 过长 q / 控制字符 `INVALID_INPUT` | ✅ 人类审计者 vs 维护者/只读/匿名 | ✅ 非法查询不改 catalog 文件字节；Portal / MCP 只读入口无 `--allow-write` | `tests/audit_query_test.ts`；`tests/portal_handler_test.ts`；`tests/mcp_protocol_test.ts`；`tests/e2e/audit_query_e2e_test.ts` |

缺口的最低期望：每行至少先有一条跨入口的 Happy Path（发布或发现能在 CLI 与 Portal 对上）；所有高风险行必须再有失败路径（未审批公开、越权、自批）；权限行必须打两种身份；写操作必须证明失败后公开面与目录不被脏写。

三个入口各有**进程级**启动烟测（`tests/e2e/entrypoint_boot_e2e_test.ts`）：spawn 真实的 `src/portal/main.ts` / `src/gateway/main.ts` / `src/cli/main.ts`，读它播报的那行 JSON，再打一次请求。`up` 整机起动另有系统级 E2E（`tests/e2e/system_up_e2e_test.ts`）：空数据目录 → `up` → 治理动作 → 重启 → 断言状态仍在，并断言停下后端口真的关闭。这两条覆盖的是**产物进程本身**，不是直接 import 的 `listen*` 函数——`src/gateway/main.ts` 曾经在 275 个测试全绿的情况下完全无法启动，原因就是当时没有任何用例执行过它。
