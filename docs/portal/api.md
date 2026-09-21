# Portal REST API 接口规范

Portal 进程不仅提供 HTML 视图，同时对外暴露了一套规范的纯只读 REST API，供自动化脚本、监控工具或其他微服务集成。

---

## 接口设计原则

- **统一 HTTP 方法**：除特殊握手外，Portal 的业务接口**严格只接受 `GET` 请求**。任何试图向 Portal 发送 `POST`、`PUT`、`PATCH` 或 `DELETE` 的请求均直接返回 `405 Method Not Allowed`。
- **信封结构**：成功返回 `{ "ok": true, "data": ... }`，失败返回 `{ "ok": false, "error": { "code": "...", "message": "..." } }`。
- **只读免责**：Portal 运行进程不具备操作系统写权限，任何接口调用均不修改磁盘数据。

---

## 核心接口列表

### 1. 目录列表接口 (`GET /api/catalog`)
获取当前鉴权上下文可见的所有服务表面列表。

```bash
curl -s -H "Authorization: Bearer $READER_SESSION" http://127.0.0.1:8788/api/catalog
```

**响应示例**：
```json
{
  "ok": true,
  "data": [
    {
      "id": "github-tools",
      "name": "GitHub 运维助手 MCP",
      "version": "1.2.0",
      "channels": ["mcp"],
      "governanceState": "internal",
      "visibility": "internal"
    }
  ]
}
```

---

### 2. 渠道专用接口 (`GET /api/mcp`、`GET /api/web`、`GET /api/cli`)
根据请求的渠道类型快速筛选并返回直连连接或包坐标。`GET /api/mcp` 与 CLI `mcp list`、MCP `portico_mcp` 同一载荷：匿名只看到已审批公开 MCP，CLI 包坐标不会出现，读操作不写目录。`GET /api/web` 与 CLI `web list`、MCP `portico_web` 同一载荷：匿名只看到已审批公开 Web，MCP 端点与 CLI 包坐标不会出现，读操作不写目录。`GET /api/cli` 与 CLI `cli list`、MCP `portico_cli` 同一载荷：匿名只看到已审批公开 CLI，MCP 端点与 Web href 不会出现，读操作不写目录。Portico 不安装、不执行该包。

```bash
# 获取所有可见的 Web 渠道服务及直连 URL
curl -s -H "Authorization: Bearer $READER_SESSION" http://127.0.0.1:8788/api/web

# 获取所有可见的 CLI 渠道服务及 JSR/NPM 包坐标
curl -s -H "Authorization: Bearer $READER_SESSION" http://127.0.0.1:8788/api/cli
```

---

### 3. 自定义门户布局接口 (`GET /api/page`)
获取维护者排布的自定义门户卡片与组件列表。与 CLI `page get`、MCP `portico_page` 同一载荷：匿名看不到内部卡片，读操作不写 page 文件。

```bash
curl -s http://127.0.0.1:8788/api/page
```

---

### 4. 安全审计视图接口 (`GET /api/audit`)
供人类安全审计者获取合并后的系统审计时间线流水。

```bash
curl -s -H "Authorization: Bearer $HUMAN_AUDITOR_SESSION" http://127.0.0.1:8788/api/audit
```

> [!NOTE]
> 仅限具备 `auditor` 角色的人类会话可成功调用。维护者、普通只读者或匿名调用将收到 `403 Forbidden`。

---

### 4a. Gateway 访问审计 (`GET /api/gateway-audit`)
列出 Gateway 允许与拒绝的直连授权记录。与 CLI `gateway audit`、MCP `portico_gateway_audit` 同一载荷。

```bash
curl -s -H "Authorization: Bearer $HUMAN_AUDITOR_SESSION" http://127.0.0.1:8788/api/gateway-audit
```

> [!NOTE]
> 仅人类审计者可读。维护者、只读者与匿名得到 `403 Forbidden`。这不是授权写入入口；`POST` 返回 `405`。读操作不改目录或审计文件。

---

### 4b. 安全审计结论 (`GET /api/conclusions`)
列出人类审计者对登记表面的追加式安全结论。主体也可以是仓库级边界契约（`boundary:runtime-l0`、`boundary:public-redaction`），这类结论带 `gate` 字段指向回答它的门禁任务。与 CLI `audit conclusions`、MCP `portico_conclusions` 同一载荷，读同一个结论文件。

```bash
# 全部结论
curl -s -H "Authorization: Bearer $HUMAN_AUDITOR_SESSION" http://127.0.0.1:8788/api/conclusions

# 按主体 / 作用域 / 判定过滤
curl -s -H "Authorization: Bearer $HUMAN_AUDITOR_SESSION" "http://127.0.0.1:8788/api/conclusions?subject=<id>&scope=public_boundary&verdict=flagged"
```

> [!NOTE]
> 仅人类审计者可读。维护者、只读者与匿名得到 `403 Forbidden`；非法枚举过滤器（`scope` / `verdict`）与未知过滤键得到 `INVALID_INPUT`。这是只读面：记录结论必须经 CLI `audit conclude`，`POST` 返回 `405`。结论与维护轨迹分开存储，维护者身份不能覆盖。读操作不创建结论文件。

---

### 4c. 审计判定现状 (`GET /api/conclusions/standings`)
人类审计对每个「主体 + 作用域」**当前**的判定，从 4b 的追加式结论轨迹推导，不是第二份存储：当前 `verdict` 与它来自的结论（`conclusionId` / `auditorId` / `at`）、上一条判定 `previousVerdict`（区分「曾被标记、后已清除」与「从未被标记」）、该主体该作用域下结论总数与 `cleared` / `flagged` 计数、边界契约的 `gate` 与可选 `note`。与 CLI `audit standings`、MCP `portico_conclusion_standings` 同一载荷。

```bash
# 当前仍被标记的主体
curl -s -H "Authorization: ******" "http://127.0.0.1:8788/api/conclusions/standings?verdict=flagged"

# 某个边界契约的当前判定
curl -s -H "Authorization: ******" "http://127.0.0.1:8788/api/conclusions/standings?subject=boundary:runtime-l0"
```

> [!NOTE]
> 仅人类审计者可读，权限与 4b 相同（维护者、只读者与匿名 `403`，且角色检查先于过滤器解析）。过滤的是**当前判定**而不是轨迹：`verdict=flagged` 只返回现在仍被标记的主体，即使轨迹里还留着已清除的旧标记。空列表表示还没有审计者作出判定，不是「全部通过」。只读面：`POST` 返回 `405`，读操作不创建结论文件。

---

### 4d. 审计封条校验 (`GET /api/audit-verify`)
重算四个支柱（目录、身份名册、Gateway 访问审计、安全结论）的封条链，回答“这些记录是否还是写入时的样子”。与 CLI `audit verify`、MCP `portico_audit_verify` 同一载荷。

```bash
curl -s -H "Authorization: ******" http://127.0.0.1:8788/api/audit-verify
```

返回每支柱的 `ok`、已封条数、`unsealed`（没有任何环节覆盖的记录数），以及被改写的第一条记录（`seq` / `kind` / `id` / 原因：`digest` 摘要不符、`missing` 记录被删、`chain` 链条断开）和链末摘要 `tip`。

配置了 `PORTICO_SEAL_ANCHORS_PATH` 时，载荷另含 `anchored`（已被检查点覆盖的支柱数）与每支柱的 `anchor`（`state`：`intact` / `moved` / `truncated` / `rewritten`，以及锚定时的 `seq` / `tip` / `links` / `foundAt`）。未配置该路径时如实返回 `anchored: 0`，不把支柱当作已校验。

> [!NOTE]
> 仅人类审计者可读。维护者、只读者与匿名得到 `403 Forbidden`。这是只读面：`POST` 返回 `405`，校验本身不改任何记录，也不写审计文件。`unsealed` 是如实报告，不代表通过；封条链能指认改写与删除，但不能自证“从未被整体重写”——这正是 `anchor.state` 回答的问题（`rewritten` / `truncated` / `moved`），钉检查点只能经 CLI `audit anchor`。

---

### 4d. 封条检查点 (`GET /api/seal-anchors`)
列出人类审计者钉下的封条检查点：谁在何时钉住了哪条链的哪个位置与摘要，最新的一条在最后。与 CLI `audit anchors`、MCP `portico_seal_anchors` 同一载荷。

```bash
curl -s -H "Authorization: ******" http://127.0.0.1:8788/api/seal-anchors
```

> [!NOTE]
> 仅人类审计者可读（其他身份 `403 Forbidden`）。只读面：`POST` 返回 `405`，该入口不会创建检查点——写入只能经 CLI `audit anchor`。锚点文件与四个支柱文件在同一台主机上，拿到写权限的人可以一并删除；检查点小而有顺序，本来就是给人抄进外部报告/运维日志的。

---

### 5. 授权轨迹接口 (`GET /api/grants`)
列出追加式身份授权记录。与 CLI `identity grants`、MCP `portico_grants` 同一载荷。

```bash
curl -s -H "Authorization: Bearer $HUMAN_AUDITOR_SESSION" http://127.0.0.1:8788/api/grants
```

> [!NOTE]
> 仅人类审计者可读。维护者、只读者与匿名得到 `403 Forbidden`。这不是授权写入入口；`POST` 返回 `405`。

---

### 5a. 身份撤回轨迹接口 (`GET /api/revokes`)
列出追加式身份撤回记录。与 CLI `identity revokes`、MCP `portico_revokes` 同一载荷。

```bash
curl -s -H "Authorization: Bearer <session>" http://127.0.0.1:8788/api/revokes
```

> [!NOTE]
> 仅人类审计者可读。维护者、只读者与匿名得到 `403 Forbidden`。这不是撤回写入入口；`POST` 返回 `405`。载荷不含凭证或会话令牌。

---

### 6. 当前身份接口 (`GET /api/whoami`)
返回当前已证明身份的 id / kind / role。与 CLI `identity whoami`、MCP `portico_whoami` 同一载荷。

```bash
curl -s -H "Authorization: Bearer <session>" http://127.0.0.1:8788/api/whoami
```

> [!NOTE]
> 已登录会话（含 Portal 上已校验的 Cloudflare Access 映射）看到自己。匿名得到 `403 Forbidden`。这不是登录入口；`POST` 返回 `405`。载荷不含邮箱、凭证或会话令牌。

---

### 7. 登录会话轨迹 (`GET /api/sessions`)
列出登录会话轨迹（id / 主体 / 创建与过期时间，作废则含 `revokedAt`）。与 CLI `identity sessions`、MCP `portico_sessions` 同一载荷。

```bash
curl -s -H "Authorization: Bearer <session>" http://127.0.0.1:8788/api/sessions
```

> [!NOTE]
> 仅人类审计者可读。维护者、只读者与匿名得到 `403 Forbidden`。这不是登录或作废入口；`POST` 返回 `405`。载荷不含令牌或哈希。

---

### 8. 登录凭证轨迹 (`GET /api/credentials`)
列出登录凭证轨迹（id / 主体 / credentialRef / 签发者 / 签发时间，作废则含 `revokedAt`）。与 CLI `identity credentials`、MCP `portico_credentials` 同一载荷。

```bash
curl -s -H "Authorization: Bearer pst1_..." http://127.0.0.1:8788/api/credentials
```

> [!NOTE]
> 仅人类审计者可读。维护者、只读者与匿名得到 `403 Forbidden`。这不是签发或作废入口；`POST` 返回 `405`。载荷不含令牌或哈希。

---

### 8a. 登录凭证作废轨迹 (`GET /api/credential-revokes`)
列出追加式登录凭证作废记录。与 CLI `identity credential revokes`、MCP `portico_credential_revokes` 同一载荷。

```bash
curl -s -H "Authorization: Bearer <session>" http://127.0.0.1:8788/api/credential-revokes
```

> [!NOTE]
> 仅人类审计者可读。维护者、只读者与匿名得到 `403 Forbidden`。这不是作废写入入口；`POST` 返回 `405`。载荷不含凭证或会话令牌。

---

### 9. 公开审批记录 (`GET /api/approvals`)
列出公开边界上的通过 / 拒绝 / 撤回记录（含可选 `note`）。与 CLI `catalog approvals`、MCP `portico_approvals` 同一载荷。

```bash
curl -s -H "Authorization: Bearer <session>" http://127.0.0.1:8788/api/approvals
```

> [!NOTE]
> 已登录身份看到同一批记录与同一顺序。匿名得到空列表，不泄漏待审、已拒绝入口或备注。人看的决定页是 `/internal/approvals`，待审候选在 `/internal/pending`（可按 `?channel=` 只读筛选 cli / mcp / web；筛选 tab 显示该渠道待审计数；入口标明种类 url / package / mcp_endpoint，引用为转义文本、不可点击；匿名均为 HTML 404）。这不是批准/驳回/撤回写入入口；`POST` 返回 `405`。

### 9a. 公开边界与受众 (`GET /api/audience/<id>`)

单条记录在公开信任边界上的状态：记录自身声明的 `claimed`、读路径实际返回的 `served`、审批轨迹对该 surface 的最新一条 `decision`、匿名是否可达的 `reachable`，以及按 id 排序的名册受众（`{id,kind,role,reachable}`）。与 CLI `catalog audience`、MCP `portico_audience` 同一载荷。

```bash
curl -s -H "Authorization: Bearer $AUDITOR_SESSION" http://127.0.0.1:8788/api/audience/docs-writer
```

> [!NOTE]
> 仅维护者与人类审计者可读；只读与匿名返回 `403 FORBIDDEN`，草稿对审计者返回 `404`（门禁先于取值，被拒身份对存在与不存在的 id 得到同一拒绝码）。`claimed` 与轨迹不一致时给出 `mismatch`：`claimed_public_without_approval`（字节自称公开而轨迹没有授予）或 `approved_without_public_record`（轨迹仍授予而字节已被写回 `internal`）；两种情况下 `reachable` 都是 `false`。每个主体的 `reachable` 与其自身 `GET /api/catalog/<id>` 的结果一致。只读：不改可见性、不追加审批记录，也不是批准入口。

### 9b. 公开边界整库巡检 (`GET /api/boundary`)

一次给出整条公开边界：`counts`（`visible` / `public_face` / `claimed_public` / `approved` / `mismatched`）、按 id 排序的 `publicFace`——每条暴露入口的 `id` / `name` / `version` / `channels` / `entry`，加上它依据的那次审批的 `approvedBy` / `approvedAt`——以及 `mismatches`（与 9a 同形的 `claimed` / `served` / `decision` / `reachable` 加 `mismatch`）。与 CLI `catalog boundary`、MCP `portico_boundary` 同一载荷。

```bash
curl -s -H "Authorization: ******" http://127.0.0.1:8788/api/boundary
```

> [!NOTE]
> 仅维护者与人类审计者可读；只读与匿名返回 `403 FORBIDDEN`。`counts.visible` 与调用者自己的 `GET /api/catalog` 条数相等——巡检只是把已有的可见性与审批轨迹并排摆出来，不是新的读权限；草稿对审计者不可见，也不进任何角色的 `publicFace`。一条记录只有同时被轨迹授予且字节暴露才进 `publicFace`，所以清单里的每条入口都带着它所依据的决定。只读：不改可见性、不追加审批记录，也不能用它消除不一致（修复仍必须走审批路径）。
