# Portico

<p align="center">
  <img src="assets/banner.svg" alt="Portico - Agent 的治理门户与准入网关" width="760"/>
</p>

<p align="center">
  <strong>Agent 不在这里运行。Agent 在这里被登记、发布、发现、授权和访问。</strong>
</p>

<p align="center">
  <a href="https://talkincode.github.io/Portico/">📖 官方文档站点</a> ·
  <a href="docs/roadmap.md">🗺️ 项目画像与路线图</a> ·
  <a href="AGENTS.md">🤖 Agent 协作守则</a> ·
  <a href="docs/ui-spec.md">🎨 UI 设计规范</a>
</p>

---

## 什么是 Portico？（说人话）

团队里的 Agent、小工具和 MCP 服务越来越多，散落在各个服务器或个人电脑上：
- 没人说得清团队到底有多少个 Agent；
- 内部测试的小工具很容易不小心被公网访问，造成数据泄露；
- 负责维护的脚本如果权限过大，可能自作主张把危险接口发布到公网。

**Portico 就是团队所有 Agent 的“门卫与接待大厅”：**
1. **统一登记造册**：无论 Agent 跑在哪，名字、版本、联系方式（MCP / Web / CLI）都在这里有一本清清楚楚的名册。
2. **严格把守信任大门**：内部测试随便用；**想要对外全网公开？必须人类安全员打勾批准**。自动化 Agent 绝不能自导自演批准自己公开。
3. **三个入口看同一本账**：网页控制台（Web Portal）、终端工具（CLI）、外部大模型调用（MCP Protocol），看到的是完全一致的治理状态。
4. **安全死磕到底**：纯 Deno 运行时，不引入 Node/Bun 杂乱依赖，操作系统级权限默认全拒，绝不存明文密钥。

---

## 30 秒极速体验

需要本地安装了 **Deno 2.9.x**（不要用 Node 或 Bun 跑本仓库）。

只需一条命令，自动起动整套系统（自带 Web 门户、鉴权网关与 MCP 服务）：

```bash
PORTICO_DATA_DIR=./data deno task up
```

终端会输出一行机读 JSON，给出三个本地访问地址：

```json
{"ok":true,"data":{"dataDir":"./data","portal":{"url":"http://127.0.0.1:8788"},"gateway":{"url":"http://127.0.0.1:8789"},"mcp":{"url":"http://127.0.0.1:8790"}}}
```

- **公开发布大厅**：打开浏览器访问 `http://127.0.0.1:8788/public` 即可直接体验！
- **内部笔记台**：访问 `http://127.0.0.1:8788/internal`（需登录会话）。

---

## 典型使用流程（3 分钟跑通）

### 1. 引导首位人类安全审计者
系统在初次起动、名册为空时，允许安全引导第一位人类管理员：

```bash
# 1. 登记首位人类审计者
deno task cli -- identity grant --identities ./data/identities.json --id human:admin --kind human --role auditor

# 2. 发放一次性凭证（token 只打印一次，系统仅存 SHA-256 哈希）
deno task cli -- identity credential issue --identities ./data/identities.json --sessions ./data/sessions.json --id human:admin

# 3. 登录换取会话令牌（Session）
deno task cli -- identity login --identities ./data/identities.json --sessions ./data/sessions.json --id human:admin --token pct1_...
```

> **注**：拿到 `pst1_...` 会话令牌后，系统初始模式永久关闭，后续所有操作均需出示 `--session` 证明身份！

### 2. 登记一个内部 Agent
由维护者 Agent 或开发者将自己的服务登记在册：

```bash
deno task cli -- catalog register \
  --catalog ./data/catalog.json \
  --identities ./data/identities.json \
  --sessions ./data/sessions.json \
  --session $MAINTAINER_SESSION \
  --input ./my-agent.json
```

此时服务状态为 `internal`，组织内部所有人可用，外部匿名访客绝对不可见。

### 3. 申请公开与人类审计把关
```bash
# 维护者提交公开申请（进入 pending_public 待审状态）
deno task cli -- catalog publish --id my-agent --visibility public ...

# 独立人类安全员审核通过（写入 approvals.json 并正式对全网公开）
deno task cli -- catalog approve --id my-agent ...
```

---

## 三类接入入口

| 入口形态 | 协议与端点 | 适用场景 | 特性保证 |
| :--- | :--- | :--- | :--- |
| **Web Portal** | HTTP `:8788` | 人类浏览与管理 | 双平面隔离（`/internal` vs `/public`），零客户端 JS，严格 CSP，4套固定语义主题。 |
| **CLI 工具** | `deno task cli` 或独立二进制 | 运维与 CI/CD 脚本 | 输出规范 `{ok, data}` 单行 JSON，强制出示 `--session`，拒绝自称头。 |
| **MCP Protocol** | JSON-RPC 2.0 `:8790` | Claude / Cursor / 外部 Agent | 暴露只读治理工具（`portico_list` 等），纯目录投影，绝不替跑外部工具。 |

---

## 本地开发与构建

```bash
# 代码静态检查与格式化
deno task check
deno task lint
deno task fmt

# 全量自动化测试回归
deno task test

# 本地文档站点构建与预览
deno task docs:build
deno task docs:serve

# 编译生成独立免依赖可执行文件（产物在 dist/ 目录）
deno task build
```

---

## 更多深入文档

详细设计、Schema 规范与运维指引请访问 **[Portico 在线文档站点](https://talkincode.github.io/Portico/)**：
- [核心架构与信任边界](https://talkincode.github.io/Portico/intro/architecture.html)
- [身份名册与登录会话模型](https://talkincode.github.io/Portico/access/sessions.html)
- [服务元数据 Schema 与状态机](https://talkincode.github.io/Portico/catalog/schema.html)
- [MCP Gateway 鉴权网关](https://talkincode.github.io/Portico/channels/mcp-gateway.html)
- [CLI 命令行完整参考手册](https://talkincode.github.io/Portico/reference/cli.html)
