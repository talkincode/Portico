# MCP 协议服务器 (JSON-RPC)

除了登记外部 MCP 服务外，Portico 自身在 `8790` 端口上实现了一个纯纯只读的 **MCP Protocol Server**。这使得任何支持 MCP 协议的智能体（如 Claude Desktop、Cursor、Cline、Gemini 等）可以直接将 Portico 添加为 Tool Server，从而以结构化的方式感知组织内部的治理资产。

---

## 协议与传输规范

- **协议规范**：JSON-RPC 2.0。
- **传输层**：HTTP POST 请求（默认监听 `http://127.0.0.1:8790`）。
- **只读保证**：服务进程运行时严格无 `--allow-write` 文件写权限。

---

## 内置治理工具一览

Portico MCP 服务端暴露了 7 个经过安全收敛的只读治理工具：

| 工具名称 (Tool Name) | 参数说明 | 权限要求 | 功能描述 |
| :--- | :--- | :--- | :--- |
| **`portico_list`** | `{ channel?: string, state?: string }` | 匿名或持会话 | 查询当前可见的服务列表。匿名请求仅返回 `approved_public` 记录。 |
| **`portico_describe`** | `{ id: string }` | 匿名或持会话 | 查询指定服务的元数据与连接信息。若无权访问返回 NOT_FOUND。 |
| **`portico_entry`** | `{ id: string, channel?: string }` | 匿名或持会话 | 获取特定渠道的直连端点或包坐标。 |
| **`portico_dashboard`**| `{}` | 匿名或持会话 | 获取系统资产大盘统计（服务总数、渠道分布、公开数）。 |
| **`portico_audit`** | `{ q?: string, kind?: string, action?: string, subject?: string }` | **仅限人类审计者** | 查询审计时间线流水。非审计者调用返回 `FORBIDDEN`。 |
| **`portico_approvals`** | `{}` | 已登录会话；匿名为空列表 | 列出公开边界审批记录（通过 / 拒绝 / 撤回）。与 CLI `catalog approvals`、Portal `GET /api/approvals` 同一载荷。 |
| **`portico_identities`** | `{}` | **维护者与人类审计者** | 列出名册身份（id / kind / role，可选 email）。只读与匿名返回 `FORBIDDEN`。不返回凭证或会话。 |

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
