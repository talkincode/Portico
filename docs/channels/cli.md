# CLI 渠道与包坐标发现

很多团队将 Agent 封装为可以在开发者本地终端或 CI/CD 流程中调用的 CLI 二进制或包分发物。

---

## 登记与入口规范

```json
{
  "id": "code-review-cli",
  "name": "代码评审命令行工具",
  "description": "本地执行静态检查与 Agent 自动评审的 CLI 客户端",
  "channels": ["cli"],
  "entry": {
    "kind": "package",
    "value": "jsr:@tools/reviewer@1.1.0"
  },
  "version": "1.1.0",
  "visibility": "internal",
  "maintainers": [{ "id": "agent:review-bot", "kind": "agent" }]
}
```

### 严格的坐标限制
为了防止恶意维护者通过登记参数在客户端主机上执行任意 Bash 脚本，Portico 对 `entry.package` 施加了极端的约束：
1. **仅允许支持的前缀**：必须以 `jsr:` 或 `npm:` 开头。
2. **纯粹的包标识符**：例如 `jsr:@scope/tool@1.0.0` 或 `npm:some-pkg@^2.0`。
3. **禁止命令语法**：严禁传入形如 `npx ...`、`curl | bash`、带管道符、重定向符或本地文件系统绝对路径的字符串。

---

## 发现与使用

三入口共用 `listCli`：同一身份看到同一批 `package` 与 `connect.mode=coordinate`，MCP 端点与 Web href 不会出现，匿名只看到已审批公开记录。Portico 不安装、不执行、不下载该包。

### 1. CLI 查询
```bash
deno task cli -- cli list \
  --catalog ./data/catalog.json \
  --identities ./data/identities.json \
  --sessions ./data/sessions.json \
  --session $READER_SESSION

deno task cli -- cli describe \
  --catalog ./data/catalog.json \
  --identities ./data/identities.json \
  --sessions ./data/sessions.json \
  --session $READER_SESSION \
  --id code-review-cli
```

输出标准结构：
```json
{
  "ok": true,
  "data": {
    "id": "code-review-cli",
    "name": "代码评审命令行工具",
    "version": "1.1.0",
    "connect": {
      "mode": "coordinate",
      "package": "jsr:@tools/reviewer@1.1.0"
    }
  }
}
```

开发人员或 CI 脚本获取到该坐标后，可通过原生包管理器（如 `deno run jsr:@tools/reviewer`）在自己的沙箱环境中执行，Portico 本身绝不参与该工具的下载与执行。

### 2. Portal `GET /api/cli`

与 CLI `cli list`、MCP `portico_cli` 同一载荷。匿名只看到已审批公开记录。这不是安装入口。

### 3. MCP `portico_cli`

与 CLI `cli list`、Portal `GET /api/cli` 同一载荷。匿名只看到已审批公开记录。这不是安装器。
