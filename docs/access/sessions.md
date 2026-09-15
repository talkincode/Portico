# 凭证签发与登录会话

在 Portico 中，会话（Session）是 CLI、Gateway 与 MCP 的**唯一有效证明**。Portal 默认同样只认会话；仅当显式启用 Cloudflare Access 时，校验通过的 JWT 可以映射到名册上的人类身份，且不会签发会话。

---

## 令牌前缀与分类

为了便于机读与肉眼审计，Portico 的安全令牌遵循严格的前缀规范：

| 令牌类型 | 前缀格式 | 说明 | 存储形式 |
| :--- | :--- | :--- | :--- |
| **凭证令牌 (Credential Token)** | `pct1_<hex>` | 用于换取会话的一次性/长期密钥。仅在 issue 时下发一次。 | 服务端仅存加盐 SHA-256 哈希 |
| **会话令牌 (Session Token)** | `pst1_<hex>` | 登录成功后返回的上下文凭据，用于 API/CLI/MCP 请求。 | 服务端存明文用于比对，具备过期时间 |

---

## 跨入口鉴权协议

无论使用哪个客户端入口，客户端均必须携带有效的 Session 令牌：

### 1. CLI 命令行
通过全局参数 `--session` 显式传入：
```bash
deno task cli -- catalog list \
  --catalog ./data/catalog.json \
  --identities ./data/identities.json \
  --sessions ./data/sessions.json \
  --session pst1_1a2b3c4d5e...
```

### 2. Web Portal 与 REST API
支持标准 HTTP Header。可选的 Cloudflare Access JWT（`Cf-Access-Jwt-Assertion`）只在 Portal 进程、且环境变量显式启用时生效；明文 `Cf-Access-Authenticated-User-Email` 不是证明。Gateway 与 MCP 忽略该头。Portico 侧步骤见 [Cloudflare Access JWT 映射](cf-access.md)。
```bash
# 推荐方式：标准 Authorization Bearer
curl -s -H "Authorization: Bearer pst1_1a2b3c4d5e..." http://127.0.0.1:8788/api/catalog

# 备选方式：自定义 Header
curl -s -H "X-Portico-Session: pst1_1a2b3c4d5e..." http://127.0.0.1:8788/api/catalog
```

### 3. MCP Protocol Server (JSON-RPC)
在发送 HTTP POST 请求时附带 Bearer Token：
```bash
curl -s -X POST http://127.0.0.1:8790 \
  -H 'Content-Type: application/json' \
  -H 'Authorization: Bearer pst1_1a2b3c4d5e...' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"portico_list","arguments":{}}}'
```

---

## 审计者查看会话轨迹

登录与作废仍走 CLI。人类审计者可以用同一只读投影核对现有会话，而不接触令牌或哈希：

- CLI：`identity sessions`
- Portal：`GET /api/sessions`
- MCP：`portico_sessions`

三者返回同一批 `id` / `subjectId` / `createdAt` / `expiresAt`（已作废则含 `revokedAt`）。维护者、只读者与匿名得到 `FORBIDDEN`。读操作不改 `sessions.json`。

## 审计者查看凭证轨迹

签发与作废仍走 CLI。人类审计者可以用同一只读投影核对已签发凭证，而不接触令牌或哈希：

- CLI：`identity credentials`
- Portal：`GET /api/credentials`
- MCP：`portico_credentials`

三者返回同一批 `id` / `subjectId` / `credentialRef` / `issuedBy` / `issuedAt`（已作废则含 `revokedAt`）。维护者、只读者与匿名得到 `FORBIDDEN`。读操作不改 `sessions.json`。这不是签发或作废入口。

凭证作废轨迹（谁在何时切断了哪个主体的登录面）走另一条只读合同：

- CLI：`identity credential revokes`
- Portal：`GET /api/credential-revokes`
- MCP：`portico_credential_revokes`

三者返回同一批 `id` / `subjectId` / `kind` / `role` / `revokedBy` / `revokedAt` / `credentials` / `sessions`。维护者、只读者与匿名得到 `FORBIDDEN`。读操作不改 `identities.json` 或 `sessions.json`。这不是作废入口。

---

## 伪造头全面拦截机制

在过去很多轻量级管理界面中，系统容易草率地读取请求头中的自称信息（例如 `X-Actor-Id`）。这在多 Agent 协作环境中极度危险：由于名册中的 Agent ID 是公开的元数据，恶意脚本只要在 Header 中填入审计者的 ID，就能冒充审计者批准自身公开！

Portico 在所有协议层做出如下防御性断言：
1. **服务端完全废弃 `X-Portico-Actor-*`**：Portal、Gateway 与 MCP 服务端完全不再读取此类请求头。带有此类头的请求只会被当作纯粹的匿名请求。
2. **CLI 拒绝单独传入 `--actor-*`**：如果命令中未提供 `--session`，却试图通过 `--actor-id` 伪装身份，CLI 将直接报错拒绝（错误代码 `USAGE`），并中止执行。
