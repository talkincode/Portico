# 记录元数据规范 (Schema)

所有登记到 Portico 的服务表面必须符合严格的 JSON Schema 契约。非法字段、未知属性或疑似包含敏感信息的值将被系统直接拒绝。

---

## 完整字段定义

登记输入（`catalog register` / `catalog draft` / `POST /review/api/submit` 的 `--input` 文件）只接受下面列
出的字段，多一个都得到 `INVALID_INPUT`：

```jsonc
{
  "id": "code-helper",              // 必填，^[a-z0-9][a-z0-9-]{0,62}[a-z0-9]$
  "name": "代码助手 MCP 服务",       // 必填，1-120 字符
  "description": "……",              // 必填，1-2000 字符
  "channels": ["mcp"],              // 必填，["mcp" | "web" | "cli"] 的非空子集
  "entry": {                        // 必填，kind 与 channels 必须对称
    "kind": "mcp_endpoint",         //   "mcp_endpoint" | "url" | "package"
    "value": "http://127.0.0.1:9000/sse"
  },
  "version": "1.0.0",               // 必填，不含空白
  "visibility": "internal",         // 必填，但只接受 "internal"：公开要另走审批
  "maintainers": [                  // 必填，非空
    { "id": "agent:docs-bot", "kind": "agent" }   // kind: "agent" | "human"
  ],
  "category": "info-assassin",      // 可选："info-assassin" | "mira-radio" | "uncategorized"
  "tags": ["web", "Agent"],         // 可选，字符串数组
  "mediaUrl": "https://cdn.example.internal/brief.mp3"  // 可选，绝对 http(s) 音视频地址
}
```

登记之后目录里存下来的记录（`catalog get` / `GET /api/catalog/:id` / `portico_list` 读到的形状）在此基础上多了治理字段：

```typescript
interface AgentSurface extends Omit<RegisterInput, "maintainers"> {
  maintainers: Array<{ id: string; kind: "agent" | "human" }>;
  /** 治理生命周期状态：由 publish / approve / reject / withdraw 推进，登记时只能是 internal 或 draft */
  governanceState: "draft" | "internal" | "pending_public" | "approved_public" | "rejected";
  /** 公开候选的提交人；只有 pending_public 起才有 */
  publicSubmission?: { submittedBy: { id: string; kind: "agent" | "human" }; submittedAt: string };
  /** ISO 8601 创建时间戳 */
  createdAt: string;
  /** ISO 8601 最后修改时间戳 */
  updatedAt: string;
}
```

---

## 字段约束与防注入规则

1. **`id` 严格合规**：
   - 必须匹配正则表达式 `^[a-z0-9][a-z0-9-]{0,62}[a-z0-9]$`。
   - 禁止使用包含路径遍历特征（如 `../`）、特殊符号或中文。
2. **`channels` 与 `entry` 强制对称**：
   - `entry` 是 `{ kind, value }` 两个字段，`kind` 必须是 `mcp_endpoint` / `url` / `package` 之一。
   - `channels: ["mcp"]` 必须配 `entry.kind: "mcp_endpoint"`；`["web"]` 配 `"url"`；`["cli"]` 配 `"package"`。
     一个表面只有一条入口，因此 `channels` 不能混装（例如同时声明 `mcp` 与 `web` 会被拒）。
3. **`visibility` 在登记时只能是 `internal`**：
   - 传 `"public"` 得到 `PUBLIC_REQUIRES_APPROVAL`，不是 `INVALID_INPUT`——这是被拒绝的越权尝试，不是格式错误。
   - 公开只能由维护者 `catalog publish --visibility public` 申请，再由独立人类审计者批准。
4. **URL 安全硬边界**：
   - 协议必须为 `http:` 或 `https:`。
   - 严禁包含凭证信息（如 `https://user:password@host`）。
   - 严禁使用 `javascript:`、`data:` 或 `file:` 伪协议。
   - Web 入口不得指向 Portico 自己的阅读页：路径为 `/s/<id>` 或 `/public/s/<id>`（忽略主机、尾斜杠与查询串）时写入失败。已公开记录不会被这条规则改写，须先撤回再更新。
5. **CLI 包坐标规则**：
   - 必须显式以 `jsr:` 或 `npm:` 作为前缀（例如 `jsr:@scope/tool` 或 `npm:some-cli-bin`）。
   - 严禁包含系统命令拼接字符（如 `;`、`|`、`&`、`$`、反引号）。
6. **未知字段全面拦截**：
   - 传入任何未在 Schema 中定义的字段（例如试图附加私有配置或模型参数），写入将失败并报错 `INVALID_INPUT`。
   - 这条规则是双向的：文档里少写一个必填字段，读者照抄得到的也是 `INVALID_INPUT`。`tests/docs_register_payload_test.ts`
     把文档里的每个登记示例直接喂给真正的登记路径，所以示例与解析器不会再各自漂移。
