# MCP Gateway 鉴权网关

Portico 的 **MCP Gateway** 运行在 `8789` 端口，它充当 MCP 服务访问的安全准入关卡与不可篡改审计记录器。

---

## 门卫角色：不执行、不代理

很多初次接触 Portico 的开发者会误以为 Gateway 是一个反向代理（Proxy）或执行网关。必须再次重申：

> **Gateway 是门卫，不是执行器。**  
> Gateway 的职责是：核验来访者的会话合法性 -> 校验目标 MCP 服务是否已授权 -> 返回直连端点 -> 向审计日志追加一条访问记录。它绝不替调用方转发工具调用流量。

---

## 鉴权与路由工作流

```text
[ 客户端 Agent ]                                     [ MCP Gateway :8789 ]                [ 外部 MCP Server ]
       │                                                       │                                    │
       │ 1. POST /gateway/mcp/:id/authorize                    │                                    │
       │    Header: Authorization: Bearer <session>            │                                    │
       ├──────────────────────────────────────────────────────►│                                    │
       │                                                       │ 2. 验证 session 合法性             │
       │                                                       │ 3. 校验该主体是否有权访问该服务     │
       │                                                       │ 4. 向 gateway-audit.json 追加流水   │
       │ 5. 返回直连路由:                                       │                                    │
       │    { ok: true, data: { endpoint: "https://..." } }    │                                    │
       │◄──────────────────────────────────────────────────────┤                                    │
       │                                                                                            │
       │ 6. 客户端使用获取到的 endpoint 直接发起 MCP 调用 ──────────────────────────────────────────►│
```

---

## API 接口与命令行

### 1. HTTP 接口调用
```bash
curl -s -X POST http://127.0.0.1:8789/gateway/mcp/github-tools/authorize \
  -H "Authorization: Bearer $READER_SESSION"
```

响应：
```json
{
  "ok": true,
  "data": {
    "id": "github-tools",
    "authorized": true,
    "connect": {
      "mode": "direct",
      "endpoint": "https://mcp.example.internal/sse"
    }
  }
}
```

### 2. CLI 快捷调用
```bash
deno task cli -- gateway authorize \
  --catalog ./data/catalog.json \
  --identities ./data/identities.json \
  --sessions ./data/sessions.json \
  --audit ./data/gateway-audit.json \
  --session $READER_SESSION \
  --id github-tools
```

---

## 网关访问审计流水 (`gateway-audit.json`)

每次成功的准入鉴权都会原子追加至 `gateway-audit.json`：
```json
{
  "id": "gw-evt-101",
  "timestamp": "2026-09-14T10:30:00.000Z",
  "serviceId": "github-tools",
  "actorId": "human:developer-alice",
  "action": "authorize",
  "granted": true
}
```

人类审计者可通过 `deno task cli -- gateway audit` 实时回溯所有 MCP 服务的调用放行记录。
