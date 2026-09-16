# MCP 协议服务器 (JSON-RPC)

除了登记外部 MCP 服务外，Portico 自身在 `8790` 端口上实现了一个纯纯只读的 **MCP Protocol Server**。这使得任何支持 MCP 协议的智能体（如 Claude Desktop、Cursor、Cline、Gemini 等）可以直接将 Portico 添加为 Tool Server，从而以结构化的方式感知组织内部的治理资产。

---

## 协议与传输规范

- **协议规范**：JSON-RPC 2.0。
- **传输层**：HTTP POST 请求（默认监听 `http://127.0.0.1:8790`）。
- **只读保证**：服务进程运行时严格无 `--allow-write` 文件写权限。

---

## 内置治理工具一览

Portico MCP 服务端暴露了 18 个经过安全收敛的只读治理工具：

| 工具名称 (Tool Name) | 参数说明 | 权限要求 | 功能描述 |
| :--- | :--- | :--- | :--- |
| **`portico_list`** | `{ channel?: string, state?: string }` | 匿名或持会话 | 查询当前可见的服务列表。匿名请求仅返回 `approved_public` 记录。 |
| **`portico_describe`** | `{ id: string }` | 匿名或持会话 | 查询指定服务的元数据与连接信息。若无权访问返回 NOT_FOUND。 |
| **`portico_entry`** | `{ id: string, channel?: string }` | 匿名或持会话 | 获取特定渠道的直连端点或包坐标。 |
| **`portico_mcp`** | `{}` | 匿名或持会话 | 列出当前身份可见的 MCP 连接信息。与 CLI `mcp list`、Portal `GET /api/mcp` 同一载荷。CLI 包坐标不会出现。匿名只看到已审批公开记录。不代理、不执行。 |
| **`portico_web`** | `{}` | 匿名或持会话 | 列出当前身份可见的 Web 直连入口。与 CLI `web list`、Portal `GET /api/web` 同一载荷。MCP 端点与 CLI 包坐标不会出现。匿名只看到已审批公开记录。不代理页面。 |
| **`portico_cli`** | `{}` | 匿名或持会话 | 列出当前身份可见的 CLI 包坐标。与 CLI `cli list`、Portal `GET /api/cli` 同一载荷。MCP 端点与 Web href 不会出现。匿名只看到已审批公开记录。不安装、不执行。 |
| **`portico_dashboard`**| `{}` | 匿名或持会话 | 获取系统资产大盘统计（服务总数、渠道分布、公开数）。 |
| **`portico_audit`** | `{ q?: string, kind?: string, action?: string, subject?: string }` | **仅限人类审计者** | 查询审计时间线流水。非审计者调用返回 `FORBIDDEN`。 |
| **`portico_approvals`** | `{}` | 已登录会话；匿名为空列表 | 列出公开边界审批记录（通过 / 拒绝 / 撤回）。与 CLI `catalog approvals`、Portal `GET /api/approvals` 同一载荷。 |
| **`portico_identities`** | `{}` | **维护者与人类审计者** | 列出名册身份（id / kind / role，可选 email）。只读与匿名返回 `FORBIDDEN`。不返回凭证或会话。 |
| **`portico_grants`** | `{}` | **仅限人类审计者** | 列出追加式授权轨迹。与 CLI `identity grants`、Portal `GET /api/grants` 同一载荷。维护者、只读与匿名返回 `FORBIDDEN`。不返回凭证或会话。 |
| **`portico_revokes`** | `{}` | **仅限人类审计者** | 列出追加式身份撤回轨迹。与 CLI `identity revokes`、Portal `GET /api/revokes` 同一载荷。维护者、只读与匿名返回 `FORBIDDEN`。不返回凭证或会话。读操作不写名册。 |
| **`portico_whoami`** | `{}` | 已登录会话；匿名 `FORBIDDEN` | 返回当前已证明身份的 id / kind / role。与 CLI `identity whoami`、Portal `GET /api/whoami` 同一载荷。不返回邮箱、凭证或会话。 |
| **`portico_sessions`** | `{}` | **仅限人类审计者** | 列出登录会话轨迹（id / 主体 / 时间，作废则含 revokedAt）。与 CLI `identity sessions`、Portal `GET /api/sessions` 同一载荷。维护者、只读与匿名返回 `FORBIDDEN`。不返回令牌或哈希。 |
| **`portico_credentials`** | `{}` | **仅限人类审计者** | 列出登录凭证轨迹（id / 主体 / credentialRef / 签发者 / 时间，作废则含 revokedAt）。与 CLI `identity credentials`、Portal `GET /api/credentials` 同一载荷。维护者、只读与匿名返回 `FORBIDDEN`。不返回令牌或哈希。 |
| **`portico_credential_revokes`** | `{}` | **仅限人类审计者** | 列出追加式登录凭证作废轨迹。与 CLI `identity credential revokes`、Portal `GET /api/credential-revokes` 同一载荷。维护者、只读与匿名返回 `FORBIDDEN`。不返回令牌或哈希。读操作不写名册。 |
| **`portico_gateway_audit`** | `{}` | **仅限人类审计者** | 列出 Gateway 访问审计。与 CLI `gateway audit`、Portal `GET /api/gateway-audit` 同一载荷。维护者、只读与匿名返回 `FORBIDDEN`。读操作不写目录或审计文件。这不是授权入口，也不执行工具。 |
| **`portico_page`** | `{}` | 匿名或持会话 | 读取维护者排布的门户组件盒。与 CLI `page get`、Portal `GET /api/page` 同一载荷。匿名看不到内部卡片。读操作不写 page 或目录。 |

---

## 调用示例

使用 `curl` 模拟智能体调用 `portico_list`：

```bash
curl -s -X POST http://127.0.0.1:8790 \
  -H 'Content-Type: application/json' \
  -H "Authorization: Bearer $READER_SESSION" \
  -d '{
    "jsonrpc": "2.0",
    "id": 1,
    "method": "tools/call",
    "params": {
      "name": "portico_list",
      "arguments": {
        "channel": "mcp"
      }
    }
  }'
```

返回标准的 MCP 工具响应信封：
```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "result": {
    "content": [
      {
        "type": "text",
        "text": "{\"ok\":true,\"data\":[{\"id\":\"github-tools\",\"name\":\"GitHub 运维助手 MCP\",...}]}"
      }
    ]
  }
}
```

> [!NOTE]
> MCP 协议服务器仅做治理信息的投影，绝对不提供任何 `execute_tool` 或代发外部调用的代理方法。
