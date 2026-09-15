# CLI 命令行工具完整参考

Portico CLI (`src/cli/main.ts`) 是系统运维与 Agent 自动化的核心工具。

---

## 全局通用规范

- **执行方式**：通过 `deno task cli -- <subcommand> [args]` 或独立二进制 `dist/portico <subcommand> [args]`。
- **输出格式**：标准输出（stdout）严格输出单行机读 JSON：
  - 成功：`{"ok": true, "data": ...}`
  - 失败：`{"ok": false, "error": {"code": "...", "message": "..."}}`
- **退出状态码**：成功退出码为 `0`；发生业务拦截或参数错误退出码为 `1`。

---

## 错误代码字典 (Error Codes)

| 错误代码 (Error Code) | 触发场景说明 |
| :--- | :--- |
| **`USAGE`** | 命令行参数缺失、参数格式错误或单独传入了伪造的 `--actor-*` 参数。 |
| **`FORBIDDEN`** | 会话主体无权执行该操作（例如 Reader 尝试登记服务、维护者尝试审批公开）。 |
| **`UNAUTHENTICATED`** | 会话令牌无效、已过期或在 `sessions.json` 中不存在。 |
| **`NOT_FOUND`** | 指定的服务 ID 或主体 ID 在数据存储中不存在。 |
| **`INVALID_STATE`** | 当前服务的生命周期状态不满足该操作的前提条件（例如对非公开服务执行撤回）。 |
| **`INVALID_INPUT`** | 传入的 JSON 数据违反 Schema 约束（如缺少必填字段、出现未知字段）。 |
| **`SELF_APPROVAL`** | 审计者尝试审批由自己登记或维护的服务公开申请。 |
| **`PUBLIC_REQUIRES_APPROVAL`**| 试图在 `catalog register` 中绕过审批直接声明公开。 |

---

## 子命令手册

### 1. `identity` 身份与会话管理
```bash
# 授予主体角色
portico identity grant --identities <path> [--sessions <path> --session <token>] --id <id> --kind <human|agent> --role <auditor|maintainer|reader> [--email <address>]

# 注销主体
portico identity revoke --identities <path> --sessions <path> --session <token> --id <id>

# 签发一次性登录凭证
portico identity credential issue --identities <path> --sessions <path> [--session <token>] --id <id>

# 作废凭证与活跃会话
portico identity credential revoke --identities <path> --sessions <path> --session <token> --id <id>

# 凭证登录换取 Session
portico identity login --identities <path> --sessions <path> --id <id> --token <pct1_...>

# 退出登录作废当前 Session
portico identity logout --sessions <path> --session <pst1_...>

# 查看当前会话所属身份与角色
portico identity whoami --identities <path> --sessions <path> --session <pst1_...>

# 列出追加式授权轨迹（仅人类审计者）
portico identity grants --identities <path> --sessions <path> --session <token>

# 列出登录会话轨迹（仅人类审计者；不含令牌或哈希）
portico identity sessions --identities <path> --sessions <path> --session <token>
```

---

### 2. `catalog` 目录与发布管理
```bash
# 内部登记新服务表面
portico catalog register --catalog <path> --identities <path> --sessions <path> --session <token> --input <record.json>

# 登记本地草稿
portico catalog draft --catalog <path> --identities <path> --sessions <path> --session <token> --input <record.json>

# 正式发布 (内部或公开候选)
portico catalog publish --catalog <path> --identities <path> --sessions <path> --session <token> --id <id> --visibility <internal|public>

# 更新受治理表面字段 (仅限 draft/internal/rejected)
portico catalog update --catalog <path> --identities <path> --sessions <path> --session <token> --id <id> --input <record.json>

# 审批公开申请 (仅限独立人类审计者)
portico catalog approve --catalog <path> --identities <path> --sessions <path> --session <token> --id <id>

# 驳回公开申请 (仅限独立人类审计者)
portico catalog reject --catalog <path> --identities <path> --sessions <path> --session <token> --id <id>

# 撤回已公开服务至内部 (仅限人类审计者)
portico catalog withdraw --catalog <path> --identities <path> --sessions <path> --session <token> --id <id>

# 列出公开边界审批记录（通过 / 拒绝 / 撤回）；匿名为空列表
portico catalog approvals --catalog <path> --identities <path> --sessions <path> --session <token>

# 列表查询可见服务
portico catalog list --catalog <path> [--identities <path> --sessions <path> --session <token>]

# 查询服务详情
portico catalog get --catalog <path> [--identities <path> --sessions <path> --session <token>] --id <id>
```

---

### 3. 渠道与网关命令
```bash
# 查询 MCP 渠道服务及连接信息
portico mcp list --catalog <path> --identities <path> --sessions <path> --session <token>
portico mcp describe --catalog <path> --identities <path> --sessions <path> --session <token> --id <id>

# 查询 Web 渠道服务及直连链接
portico web list --catalog <path> --identities <path> --sessions <path> --session <token>
portico web describe --catalog <path> --identities <path> --sessions <path> --session <token> --id <id>

# 查询 CLI 渠道服务及包坐标
portico cli list --catalog <path> --identities <path> --sessions <path> --session <token>
portico cli describe --catalog <path> --identities <path> --sessions <path> --session <token> --id <id>

# 网关准入鉴权与路由获取
portico gateway authorize --catalog <path> --identities <path> --sessions <path> --audit <audit.json> --session <token> --id <id>

# 查询网关访问审计流水
portico gateway audit --identities <path> --sessions <path> --audit <audit.json> --session <token>
```

---

### 4. 审计与门户组件盒命令
```bash
# 查询系统全局聚合审计时间线
portico audit list --catalog <path> --identities <path> --sessions <path> --session <token> [--limit <n>]

# 设置自定义门户卡片配置
portico page set --page <path> --catalog <path> --identities <path> --sessions <path> --session <token> --input <page.json>

# 获取当前门户排布配置
portico page get --page <path> --catalog <path> --identities <path> --sessions <path> --session <token>
```
