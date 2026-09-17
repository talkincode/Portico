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
curl -s -H "Authorization: ******" http://127.0.0.1:8788/api/gateway-audit
```

> [!NOTE]
> 仅人类审计者可读。维护者、只读者与匿名得到 `403 Forbidden`。这不是授权写入入口；`POST` 返回 `405`。读操作不改目录或审计文件。

---

### 5. 授权轨迹接口 (`GET /api/grants`)
列出追加式身份授权记录。与 CLI `identity grants`、MCP `portico_grants` 同一载荷。

```bash
curl -s -H "Authorization: ******" http://127.0.0.1:8788/api/grants
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
curl -s -H "Authorization: ******" http://127.0.0.1:8788/api/whoami
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
curl -s -H "Authorization: ******" http://127.0.0.1:8788/api/approvals
```

> [!NOTE]
> 已登录身份看到同一批记录与同一顺序。匿名得到空列表，不泄漏待审、已拒绝入口或备注。人看的决定页是 `/internal/approvals`，待审候选在 `/internal/pending`（可按 `?channel=` 只读筛选 cli / mcp / web；入口标明种类 url / package / mcp_endpoint，引用为转义文本、不可点击；匿名均为 HTML 404）。这不是批准/驳回/撤回写入入口；`POST` 返回 `405`。
