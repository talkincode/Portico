# Web 渠道与直连发现

许多 Agent 系统附带了人类可交互的 Web 控制台或调试看板。Portico 为 Web 渠道提供了安全的登记与受控链接分发。

---

## 登记与入口要求

在服务描述中声明 Web 渠道：
```json
{
  "id": "agent-dashboard",
  "name": "多智能体协作观测台",
  "description": "实时查看多 Agent 交互拓扑与任务状态的 Web 前端",
  "channels": ["web"],
  "entry": {
    "kind": "url",
    "value": "https://dashboard.example.internal/workspace"
  },
  "version": "2.0.0",
  "visibility": "internal",
  "maintainers": [{ "id": "agent:dashboard-bot", "kind": "agent" }]
}
```

### 安全限制
- 必须为绝对的 `http://` 或 `https://` 地址。
- 严禁包含凭证信息或用户名。
- 严禁包含 `javascript:`、`vbscript:` 或 `data:` 伪协议（防止存储型 XSS 漏洞）。

---

## 查询与直连发现

三入口共用 `listWeb`：同一身份看到同一批 `href` 与 `connect.mode=direct`，MCP 端点与 CLI 包坐标不会出现，匿名只看到已审批公开记录。Portico 不抓取、不代理、不渲染远程页面。

### 1. CLI 命令行
```bash
# 列出可见的 Web 渠道服务
deno task cli -- web list \
  --catalog ./data/catalog.json \
  --identities ./data/identities.json \
  --sessions ./data/sessions.json \
  --session $READER_SESSION

# 查询 Web 直连入口
deno task cli -- web describe \
  --catalog ./data/catalog.json \
  --identities ./data/identities.json \
  --sessions ./data/sessions.json \
  --session $READER_SESSION \
  --id agent-dashboard
```

输出机读 JSON：
```json
{
  "ok": true,
  "data": {
    "id": "agent-dashboard",
    "name": "多智能体协作观测台",
    "version": "2.0.0",
    "connect": {
      "mode": "direct",
      "href": "https://dashboard.example.internal/workspace"
    }
  }
}
```

### 2. Portal API 与页面直连按钮

```bash
curl -s -H "Authorization: Bearer $READER_SESSION" http://127.0.0.1:8788/api/web
```

在 Web Portal 的卡片与详情页中，经过授权的身份将看到一个直接跳转的外链按钮（带有 `rel="noopener noreferrer"`），用户可一键点击进入目标系统的控制台，而 Portico 不对目标网页实施反向代理或内容修改。

### 3. MCP `portico_web`

与 CLI `web list`、Portal `GET /api/web` 同一载荷。匿名只看到已审批公开记录。这不是页面代理。
