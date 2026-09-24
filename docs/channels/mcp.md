# MCP 渠道与连接信息

Model Context Protocol (MCP) 是当前连接 AI 智能体与外部工具、知识库的主流开放协议。Portico 针对外部 MCP Server 提供了严格的元数据治理规范。

---

## 登记与入口要求

在服务描述中声明 MCP 渠道：
```json
{
  "id": "github-tools",
  "name": "GitHub 运维助手 MCP",
  "description": "提供仓库分支、Issue 与 PR 自动分析的 MCP 服务",
  "channels": ["mcp"],
  "entry": {
    "kind": "mcp_endpoint",
    "value": "https://mcp.example.internal/sse"
  },
  "version": "1.2.0",
  "visibility": "internal",
  "maintainers": [{ "id": "agent:github-bot", "kind": "agent" }]
}
```

### 安全规范
1. **端点协议**：必须为绝对的 `http://` 或 `https://` 地址。
2. **严禁包含凭证**：URL 中严禁携带基本认证信息（例如 `https://token:secret@...`）。
3. **禁止命令注入**：严禁在此处传入可执行命令（如 `npx -y @modelcontextprotocol/server-github`）。Portico 登记的是**已经启动的远程服务端点**，而非在本地主机拉起进程的命令。

---

## 查询与连接信息发现

用户或调用 Agent 可以通过 CLI、Portal 或 MCP 查询已授权的 MCP 连接信息。三入口共用 `listMcp`：同一身份看到同一批 `endpoint` 与 `connect.mode=direct`，CLI 包坐标不会出现，匿名只看到已审批公开记录。

### CLI 查询
```bash
# 列出可见的 MCP 渠道服务
deno task cli -- mcp list \
  --catalog ./data/catalog.json \
  --identities ./data/identities.json \
  --sessions ./data/sessions.json \
  --session $READER_SESSION

# 查看特定服务的连接坐标
deno task cli -- mcp describe \
  --catalog ./data/catalog.json \
  --identities ./data/identities.json \
  --sessions ./data/sessions.json \
  --session $READER_SESSION \
  --id github-tools
```

输出标准结构：
```json
{
  "ok": true,
  "data": {
    "id": "github-tools",
    "name": "GitHub 运维助手 MCP",
    "version": "1.2.0",
    "connect": {
      "mode": "direct",
      "endpoint": "https://mcp.example.internal/sse"
    }
  }
}
```

### Portal API
```bash
curl -s -H "Authorization: Bearer $READER_SESSION" http://127.0.0.1:8788/api/mcp
```
返回经过当前会话鉴权过滤后的全部可访问 MCP 服务列表。
