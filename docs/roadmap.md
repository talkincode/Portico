# Portico 项目画像与方向

## 项目概述

Portico 是组织的 Agent **门户与治理层**：Agent 在别处运行，通过这里被登记、发布、发现、授权和访问。它提供 Web Portal、CLI、MCP 三类入口，把内部可见与公开可见分成两条信任边界；公开必须经过审批。系统按 CMS 式分级权限运转，但日常维护委派给 Agent，人类只做安全审计。

> **需修订（已修订）：** 原文写“当前仓库几乎是空的……没有运行时代码、测试或 CI”。2026-09-13 起仓库已有 Deno 运行时骨架、内部 Registry 目录、Publisher 草稿/内部发布/公开候选、Approval 公开发布审批、Access Control 身份名册、只读 Portal 发现、MCP 渠道登记与授权连接信息、MCP Gateway 鉴权/路由/访问审计（只做门卫，不执行工具、不代理流量）、人类安全审计视图、受约束的 UI Components 门户组件盒（固定种类，不能当 CMS），以及一次性下发的登录会话（哈希存储，非外部 IdP）；未实现的模块仍是产品意图，不是现存实现。

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

- Registry 内部目录

`src/catalog/` 是目录内核。维护者可登记内部 Agent 表面（身份、名称、说明、渠道、版本、入口引用、维护者、治理状态=`internal`）。公开可见性不能通过登记“顺便成功”；未知字段或明文密钥字段被拒绝；失败不写目录。只读者可见内部记录，匿名不可见。

- CLI 目录登记、草稿、发布与查询

`src/cli/main.ts`：`identity grant|list|grants|credential issue|login|logout|whoami`、`catalog register|draft|publish|approve|reject|withdraw|list|get`、`mcp list|describe`、`gateway authorize|audit`、`audit list` 与 `page set|get`，一次调用结束，stdout 为 `{ok,data}` / `{ok,error:{code,message}}`。非匿名命令对照身份名册解析 `--actor-*`，或在登录后用 `--session` 代替。外部 IdP 尚未实现。

- Publisher 内部发布与公开候选

维护者可以把草稿发布为内部（只读者立即可见），或把内部/草稿提交为公开候选（`governanceState=pending_public`）。公开候选对匿名仍不可见、不可达；不能经 publish 写成 `approved_public`；无权或非法字段失败后不脏写。

- Approval 公开发布审批

独立人类审计者可 `approve` / `reject` 公开候选。提交同一请求的身份不能自批（`SELF_APPROVAL`）；维护者与 Agent 不能审。通过后匿名可见 `approved_public`；拒绝后公开面仍不可达。审批记录与目录记录分开追加，维护者不能改写。审批者必须已在身份名册中被授予 human auditor，不能靠 `--actor-role` 自封。

- 撤回公开发布

已 `approved_public` 的记录可由人类审计者 `catalog withdraw --id <id>` 撤回：记录回到 `governanceState=internal`、`visibility=internal`，公开入口（CLI、Portal、Gateway）对匿名与组织外主体立即消失，响应不泄漏端点；只读及以上身份仍可见同一条内部记录。撤回是公开信任边界的收缩方向，因此与批准同一权限面：只有人类审计者能撤回，维护者、Agent、只读者与匿名得到 `FORBIDDEN`。只有仍然公开的记录可撤回，`internal` / `pending_public` / `rejected` 得到 `INVALID_STATE`，重复撤回同样 `INVALID_STATE`。撤回在审批轨迹中留下 `withdrawn` 记录（谁撤回、何时、撤回的是哪个版本），维护者不能改写。撤回后再次 `publish --visibility public` 只回到 `pending_public`，必须重新经独立审批才能重新公开。失败撤回不写目录、不追加审批记录。

- Access Control 身份名册

`src/access/` 保存身份与追加式授权记录。空名册只能引导第一位人类审计者；之后仅人类审计者可 grant。Agent 不能被授予 auditor；主体不能给自己提权。失败不写名册。catalog CLI 用名册解析角色。名册文件仍是本地信任根，不是外部 IdP。

- Portal 发现与治理仪表盘

`src/portal/` 是只读 HTTP 入口，消费同一 `CatalogService`。`GET /api/catalog`、`GET /api/catalog/:id`、`GET /api/dashboard`、`GET /api/mcp`、`GET /api/mcp/:id`、`GET /api/audit` 与 `GET /`（HTML）对同一身份呈现与 CLI 相同的可见性（审计面仅人类审计者）。无 actor 头且无会话为匿名；`X-Portico-Actor-*` 对照身份名册解析，不能自封角色；`Authorization: Bearer` / `X-Portico-Session` 解析已登录会话且角色以名册为准。默认绑定 `127.0.0.1`。POST/PUT/PATCH/DELETE 返回 405，不写目录。登录在 CLI 完成；Portal 只读消费会话文件。

- MCP 渠道登记与访问

维护者可登记 `channels=["mcp"]` 且 `entry.kind=mcp_endpoint` 的外部 MCP Server。端点必须是绝对 http(s) URL，禁止 userinfo、查询串密钥和命令式入口。`mcp list` / `mcp describe` 与 Portal `GET /api/mcp` 对同一身份返回连接信息 `{endpoint, connect:{mode:"direct"}}`，由客户端直连；Portico 不执行工具、不代理流量。可见性与目录相同：内部对匿名不可见，公开须审批。CLI 表面不会出现在 MCP 列表。失败登记不写目录。

- MCP Gateway 鉴权与路由（门卫）

`src/gateway/` 对已登记 MCP 做身份、可见性与访问审计，再发出直连路由。`gateway authorize` 与 `POST /gateway/mcp/:id/authorize` 对同一身份返回 `{endpoint, connect:{mode:"direct"}}`；不转发 JSON-RPC、不执行工具、不代理流量。未授权或未审批公开得到 `NOT_FOUND`，响应不泄漏端点。允许与拒绝都追加到独立审计文件；人类审计者可 `gateway audit` / `GET /gateway/audit`，维护者不能读、也不能改写。工具调用类 POST 返回 405。默认绑定 `127.0.0.1`。失败授权不改目录。

- 人类安全审计视图

`src/audit/` 给人类审计者一条只读时间线。`audit list` 与 Portal `GET /api/audit` 对同一身份合并：追加式目录变更（register / draft / publish）、身份授权、公开审批，以及可选 Gateway 访问审计。维护者与 Agent 得到 `FORBIDDEN`；没有改写或删除入口。Portal 写方法仍 405，失败登记不写目录变更。审计结论与维护轨迹分开存储，维护者身份不能覆盖。

- UI Components 受约束门户组件

`src/ui/` 是固定种类的组件盒：`catalog_card`、`catalog_detail`、`permission_hint`、`approval_status`、`audit_snippet`。维护者可用 `page set` 把组件绑定到已有目录记录；`page get` 与 Portal `GET /api/page` / `GET /` 对同一身份解析。解析走目录可见性：内部与待审公开对匿名不可见，不能靠放进页面绕过审批。未知种类、HTML/主题字段、明文密钥被拒。`audit_snippet` 只对人类审计者填充。Portal 仍只读，POST `/api/page` 为 405。这不是 CMS、建站器或任意页面。

- 登录会话

人类审计者可 `identity credential issue` 一次性下发登录凭证；主体 `identity login` 换会话。凭证与会话只存 SHA-256，不落明文密钥或口令。CLI `--session` 与 Portal / Gateway `Authorization: Bearer`（或 `X-Portico-Session`）解析同一会话，角色始终从名册读取，不能靠会话头自封 auditor。失败登录不写会话；logout 后原令牌不可用。`--session` 与 `--actor-*` 不能混用。Portal 仍无 `--allow-write`。这不是外部 IdP、口令库或 OAuth。

- 尚未实现

外部 IdP / 联邦登录。标为待核验以外的“已有能力”一律不应被写出。

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

Registry 内部登记、Publisher 草稿/内部发布/公开候选、Approval 通过/拒绝、公开发布撤回、Access Control 身份名册、登录会话、Portal 发现/仪表盘、MCP 渠道登记/连接信息、MCP Gateway 鉴权路由、人类安全审计视图、UI Components 门户页维护，以及 CLI 对应命令已有测试证据。外部 IdP 仍为缺口。非匿名 `--actor-*`、`--session` 与 Portal / Gateway `X-Portico-Actor-*` / Bearer 必须与身份名册一致；会话不冻结、不提升角色。

| 一级功能 | 风险级别 | Happy Path E2E | 失败路径 | 权限角色覆盖 | 失败恢复/回滚 | 证据（测试路径/用例） |
| --- | --- | --- | --- | --- | --- | --- |
| Registry 登记与目录 | 高 | ✅ 维护者登记内部表面，只读者 list/get 同一条 | ✅ 公开可见性被拒；偷写 `approved_public` 被拒；非法 id / 明文密钥字段被拒 | ✅ 只读 vs 维护者；匿名看不到内部记录 | ✅ 失败不写 Memory/File 目录 | `tests/catalog_service_test.ts`；`tests/e2e/cli_catalog_e2e_test.ts` |
| Publisher 内部发布 | 高 | ✅ 草稿对只读隐藏；`publish --visibility internal` 后只读者可见同一条 | ✅ 无权 draft/publish 被拒；偷写 `approved_public`/明文密钥被拒；不能把 pending_public 降回 internal | ✅ 维护者 vs 只读；匿名看不到公开候选 | ✅ 失败不写/不改目录；公开候选对匿名仍不可达 | `tests/catalog_publisher_test.ts`；`tests/e2e/cli_publish_e2e_test.ts` |
| Approval 公开发布审批 | 高 | ✅ 独立人类审计者 approve 后匿名 list/get 同一条 `approved_public` | ✅ 自批 SELF_APPROVAL；维护者/Agent/只读 FORBIDDEN；拒绝后匿名仍不可见；密钥字段被拒 | ✅ 提交者 vs 人类审计者；维护者不能审 | ✅ 失败不写审批记录、不改公开面；已拒绝不能再 reject 改写 | `tests/catalog_approval_test.ts`；`tests/e2e/cli_approval_e2e_test.ts` |
| 公开发布撤回 | 高 | ✅ 人类审计者 `catalog withdraw --id` 后，匿名在 CLI `list`/`get`、Portal `/api/catalog` 与 `/api/mcp`、Gateway authorize 上同时不可达；只读者仍见同一条 `internal` | ✅ 维护者/Agent/只读者/匿名撤回 FORBIDDEN；未知 id NOT_FOUND；对 `internal`/`pending_public`/`rejected` 与重复撤回 INVALID_STATE；密钥字段被拒 | ✅ 人类审计者 vs 维护者/Agent/只读者/匿名 | ✅ 失败撤回不改目录文件字节、不追加审批记录，公开面仍 `approved_public`；撤回后重发只回 `pending_public`，须重新独立审批才能再公开 | `tests/catalog_withdraw_test.ts`；`tests/e2e/cli_withdrawal_e2e_test.ts` |
| Portal 发现与仪表盘 | 中 | ✅ CLI register 后 reader 在 Portal list/HTML 看到同一条；approve 后匿名 Portal 与 CLI 同一条 `approved_public` | ✅ 内部与 pending_public 对匿名不可见；POST 405；冒充 auditor FORBIDDEN；HTML 转义名称 | ✅ reader vs 匿名 | ✅ 失败写不改 catalog 文件；只读入口无 `--allow-write` | `tests/portal_handler_test.ts`；`tests/e2e/portal_discovery_e2e_test.ts` |
| Access Control 分级权限 | 高 | ✅ 审计者授予 Agent 维护者后，维护者 register、只读者 list 同一条 | ✅ 维护者自封 auditor FORBIDDEN；Agent 不能被授予 auditor；未知身份不能 register | ✅ 人类审计者 vs Agent 维护者；只读者不能 list 名册 | ✅ 失败 grant 不改 identities/grants；失败 approve 不改公开面 | `tests/access_service_test.ts`；`tests/e2e/cli_access_e2e_test.ts` |
| 登录会话 | 高 | ✅ 审计者一次性下发凭证；主体 login 后 CLI `--session` list 与 Portal Bearer 看到同一条内部记录 | ✅ 错误 token 登录 FORBIDDEN；会话上伪造 auditor 头 FORBIDDEN；无效 Bearer 403；维护者 session 不能 approve | ✅ 只读 session 不能 register；维护者 session 不能审公开 | ✅ 失败登录不写 session 记录；logout 后原令牌不可用且不改 catalog | `tests/access_session_test.ts`；`tests/e2e/cli_session_e2e_test.ts`；`tests/e2e/portal_session_e2e_test.ts` |
| CLI 发布与查询 | 高 | ✅ `identity grant` 后 `catalog register`，reader `list`/`get`；`draft`→`publish internal` 后 reader 可见；`approve` 后匿名可见 | ✅ reader 登记/draft/publish FORBIDDEN；公开登记 PUBLIC_REQUIRES_APPROVAL；公开 publish 后匿名 list 为空；自批/维护者 approve 失败；未授权身份 FORBIDDEN | ✅ 维护者 vs 只读 vs 人类审计者；匿名看不到内部、待审与审批记录 | ✅ 失败不创建/不改 catalog 文件、approvals 与 identities | `tests/e2e/cli_catalog_e2e_test.ts`；`tests/e2e/cli_publish_e2e_test.ts`；`tests/e2e/cli_approval_e2e_test.ts`；`tests/e2e/cli_access_e2e_test.ts` |
| MCP 渠道登记与访问 | 高 | ✅ 维护者登记 mcp_endpoint；只读者 `mcp list`/`describe` 与 Portal `/api/mcp` 同一连接信息 | ✅ 密钥查询/userinfo/命令式入口被拒；CLI 表面不出现在 MCP 列表；匿名看不到内部 MCP；未审批公开 MCP 对匿名不可达 | ✅ 只读 vs 匿名；维护者可登记、只读者可描述 | ✅ 失败登记不写 catalog 文件；Portal POST `/api/mcp` 不改目录 | `tests/mcp_channel_test.ts`；`tests/e2e/cli_mcp_e2e_test.ts`；`tests/e2e/portal_mcp_e2e_test.ts`；`tests/portal_handler_test.ts` |
| MCP Gateway 鉴权与路由 | 高 | ✅ 维护者登记 MCP 后，只读者 `gateway authorize` 与 HTTP `POST /gateway/mcp/:id/authorize` 得到同一 `connect.mode=direct` 路由；审计者可读到 allowed 记录 | ✅ 匿名内部/待审公开 NOT_FOUND 且不泄漏端点；CLI 表面不可授权；`tools/call` 返回 405 且不执行 | ✅ 已授权 reader vs 匿名；维护者不能读审计 | ✅ 失败授权不改 catalog 文件；拒绝工具调用不脏写目录 | `tests/gateway_service_test.ts`；`tests/gateway_handler_test.ts`；`tests/e2e/cli_gateway_e2e_test.ts`；`tests/e2e/gateway_http_e2e_test.ts` |
| UI Components 门户页维护 | 中 | ✅ 维护者 `page set` 组合 catalog_card；只读者 CLI `page get` 与 Portal `/api/page`、HTML 看到同一张卡 | ✅ 未知种类/HTML/密钥字段被拒；内部卡对匿名不可见；待审公开仍不可达 | ✅ 维护者 vs 只读；匿名看不到未审批引用 | ✅ 失败 set 不写 page 文件；Portal POST `/api/page` 405 且不改 page/catalog | `tests/ui_page_test.ts`；`tests/portal_page_handler_test.ts`；`tests/e2e/cli_page_e2e_test.ts`；`tests/e2e/portal_page_e2e_test.ts` |
| Agent 维护与人类安全审计 | 高 | ✅ 维护者登记并提交公开后，人类审计者 `audit list` 与 Portal `GET /api/audit` 看到同一条目录变更、授权与审批时间线 | ✅ 维护者/只读/匿名 FORBIDDEN；Portal PATCH/POST `/api/audit` 405；失败公开登记不出现 catalog 事件 | ✅ 维护 Agent vs 人类审计者；维护者不能读、不能改写 | ✅ 失败登记不写 catalog 文件与变更日志；读审计不改授权/审批记录 | `tests/catalog_change_test.ts`；`tests/audit_service_test.ts`；`tests/portal_handler_test.ts`；`tests/e2e/cli_audit_e2e_test.ts`；`tests/e2e/portal_audit_e2e_test.ts` |

缺口的最低期望：每行至少先有一条跨入口的 Happy Path（发布或发现能在 CLI 与 Portal 对上）；所有高风险行必须再有失败路径（未审批公开、越权、自批）；权限行必须打两种身份；写操作必须证明失败后公开面与目录不被脏写。
