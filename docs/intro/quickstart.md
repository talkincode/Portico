# 快速上手指南

本指南将带您在 5 分钟内完成 Portico 的起动、首位审计者初始化、维护者授权、服务登记与公开审批流程。

---

## 1. 环境准备

确保您的本地环境中已安装 **Deno 2.9.x**：

```bash
deno --version
# 输出应包含 deno 2.9.x
```

> [!NOTE]
> 请勿尝试使用 Node.js 或 Bun 运行本仓库命令，Portico 运行时严格锁定为 Deno。

---

## 2. 一键起动整套系统

Portico 内置 supervisor 管理脚本。只需指定数据存储目录，即可同时起动 Portal、Gateway、MCP 与 Review 服务：

```bash
PORTICO_DATA_DIR=./data deno task up
```

起动成功后，标准输出将打印包含四个服务 URL 的 JSON：

```json
{"ok":true,"data":{"dataDir":"./data","portal":{"url":"http://127.0.0.1:8788"},"gateway":{"url":"http://127.0.0.1:8789"},"mcp":{"url":"http://127.0.0.1:8790"},"review":{"url":"http://127.0.0.1:8791"}}}
```

> [!NOTE]
> `up` 不做反向代理：Review 在自己的端口上。想在浏览器里点审批，启动时就声明它：
> `PORTICO_REVIEW_ORIGIN=http://127.0.0.1:8791/review PORTICO_DATA_DIR=./data deno task up`
> （声明的是审批表单挂载的基址：Review 进程自己的路径前缀 `/review` 要写进去，末尾斜杠可有可无）。
> 不声明时按「同源」处理，那只在 `/review` 被代理到同一 origin 的部署（例如 macstudio 的隧道）里成立。

保持该终端窗口运行，另开一个新终端进行后续操作。

---

## 3. 引导第一位人类安全审计者 (Bootstrap)

在初始状态下，`data/identities.json` 为空。系统允许无凭证引导首位拥有 `auditor` 角色的人类身份：

```bash
# 1. 注册首位人类审计者
deno task cli -- identity grant \
  --identities ./data/identities.json \
  --id human:security-auditor --kind human --role auditor

# 2. 签发一次性登录凭证令牌 (token 只打印一次，系统仅存哈希)
deno task cli -- identity credential issue \
  --identities ./data/identities.json \
  --sessions ./data/sessions.json \
  --id human:security-auditor
# 控制台输出（凭证令牌在 data.token）：
# {"ok":true,"data":{"id":"crd-...","subjectId":"human:security-auditor","credentialRef":"issued:crd-...","token":"pct1_...","issuedAt":"..."}}

# 3. 使用凭证换取有效会话 (Session)
deno task cli -- identity login \
  --identities ./data/identities.json \
  --sessions ./data/sessions.json \
  --id human:security-auditor \
  --token pct1_<您获取的token>
# 控制台输出（会话令牌在 data.token，不是 data.session）：
# {"ok":true,"data":{"sessionId":"ses-...","token":"pst1_...","actor":{"id":"human:security-auditor","kind":"human","role":"auditor"},"expiresAt":"..."}}
```

> [!IMPORTANT]
> 首张凭证发放成功后，系统的 Bootstrap 模式将永久关闭！后续的所有授权与变更操作必须由已登录审计者签署。

我们将拿到的会话令牌保存到环境变量中便于调用：

```bash
export AUDITOR_SESSION="pst1_..."
```

---

## 4. 授权维护者 Agent

由审计者授权一个负责编目维护的 Agent：

```bash
# 1. 授予 Agent maintainer 权限
deno task cli -- identity grant \
  --identities ./data/identities.json \
  --sessions ./data/sessions.json \
  --session $AUDITOR_SESSION \
  --id agent:docs-bot --kind agent --role maintainer

# 2. 为该 Agent 签发凭证
deno task cli -- identity credential issue \
  --identities ./data/identities.json \
  --sessions ./data/sessions.json \
  --session $AUDITOR_SESSION \
  --id agent:docs-bot

# 3. Agent 登录获取会话
deno task cli -- identity login \
  --identities ./data/identities.json \
  --sessions ./data/sessions.json \
  --id agent:docs-bot \
  --token pct1_<agent的token>
```

保存维护者会话：
```bash
export AGENT_SESSION="pst1_..."
```

---

## 5. 登记并发布服务

维护者 Agent 准备一份服务描述文件 `mcp-agent.json`：

```json
{
  "id": "code-helper",
  "name": "代码助手 MCP 服务",
  "description": "提供代码审查与重构建议的外部 MCP 工具集合",
  "channels": ["mcp"],
  "entry": {
    "kind": "mcp_endpoint",
    "value": "http://127.0.0.1:9000/sse"
  },
  "version": "1.0.0",
  "visibility": "internal",
  "maintainers": [{ "id": "agent:docs-bot", "kind": "agent" }]
}
```

执行内部登记：

```bash
deno task cli -- catalog register \
  --catalog ./data/catalog.json \
  --identities ./data/identities.json \
  --sessions ./data/sessions.json \
  --session $AGENT_SESSION \
  --input ./mcp-agent.json
```

此时打开浏览器访问 `http://127.0.0.1:8788/internal`，可查看到该记录；但公开页 `http://127.0.0.1:8788/public` 上该服务绝对不可见。

浏览器不带 Header，需要先登录：打开 `http://127.0.0.1:8788/login`，用 `human:security-auditor` 和同一枚 `pct1_` 凭证登录（凭证可重复使用，直到 `identity credential revoke` 作废它）。登录成功后直接落在 `/internal`；已登录时页眉里有「内部工作台」入口。启用 GitHub OAuth 的部署也可以用 `/login` 上的一键登录。

---

## 6. 申请公开与独立审批

维护者 Agent 提交公开申请：

```bash
deno task cli -- catalog publish \
  --catalog ./data/catalog.json \
  --identities ./data/identities.json \
  --sessions ./data/sessions.json \
  --session $AGENT_SESSION \
  --id code-helper \
  --visibility public
```

此时服务进入 `pending_public`（待审）状态。维护者尝试自批将被系统拦截（`SELF_APPROVAL`）。

人类审计者进行独立安全审计并批准：

```bash
deno task cli -- catalog approve \
  --catalog ./data/catalog.json \
  --identities ./data/identities.json \
  --sessions ./data/sessions.json \
  --session $AUDITOR_SESSION \
  --id code-helper
```

人类审计者也可以在浏览器里完成这一步：登录后打开 `http://127.0.0.1:8788/internal?state=pending_public`，详情页上按当前身份显示「通过 / 驳回」。Portal 依然没有目录写权限——表单提交给 Review 进程，由它执行审批。

审批完成！现在在任何匿名浏览器窗口直接打开：
- 门户公开页：`http://127.0.0.1:8788/public`
- 即可查看到 `code-helper` 服务已经合规向外界发布！
