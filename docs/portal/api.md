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
根据请求的渠道类型快速筛选并返回直连连接或包坐标：

```bash
# 获取所有可见的 Web 渠道服务及直连 URL
curl -s -H "Authorization: Bearer $READER_SESSION" http://127.0.0.1:8788/api/web

# 获取所有可见的 CLI 渠道服务及 JSR/NPM 包坐标
curl -s -H "Authorization: Bearer $READER_SESSION" http://127.0.0.1:8788/api/cli
```

---

### 3. 自定义门户布局接口 (`GET /api/page`)
获取维护者排布的自定义门户卡片与组件列表：

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
