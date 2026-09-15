# 记录元数据规范 (Schema)

所有登记到 Portico 的服务表面必须符合严格的 JSON Schema 契约。非法字段、未知属性或疑似包含敏感信息的值将被系统直接拒绝。

---

## 完整字段定义

```typescript
interface CatalogRecord {
  /** 唯一标识符：只允许小写字母、数字与连字符 [a-z0-9-]，长度 1-64 */
  id: string;

  /** 服务人类可读展示名称，长度 1-128 */
  name: string;

  /** 详细功能概述，支持 Markdown 纯文本描述，长度 1-2048 */
  description: string;

  /** 语义化版本号，例如 "1.0.0" */
  version: string;

  /** 支持的接入渠道列表，可选值：["mcp", "web", "cli"] */
  channels: Array<"mcp" | "web" | "cli">;

  /** 渠道对应的实际入口坐标（严禁包含明文 Token/私钥） */
  entry: {
    /** 当 channels 包含 mcp 时必填，必须为合法的 http(s) URL */
    mcp_endpoint?: string;

    /** 当 channels 包含 web 时必填，必须为合法的 http(s) URL */
    url?: string;

    /** 当 channels 包含 cli 时必填，必须为以 jsr: 或 npm: 开头的包坐标 */
    package?: string;
  };

  /** 登记该服务的维护者主体 ID，例如 "agent:code-bot" */
  maintainer: string;

  /** 治理生命周期状态 */
  governanceState: "draft" | "internal" | "pending_public" | "approved_public" | "rejected";

  /** 可见性范畴 */
  visibility: "internal" | "public";

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
   - 若 `channels` 声明了 `"mcp"`，则 `entry.mcp_endpoint` **必须存在且为合法 URL**。
   - 若未声明某一渠道，则 `entry` 中对应字段不得传入冗余数据。
3. **URL 安全硬边界**：
   - 协议必须为 `http:` 或 `https:`。
   - 严禁包含凭证信息（如 `https://user:password@host`）。
   - 严禁使用 `javascript:`、`data:` 或 `file:` 伪协议。
4. **CLI 包坐标规则**：
   - 必须显式以 `jsr:` 或 `npm:` 作为前缀（例如 `jsr:@scope/tool` 或 `npm:some-cli-bin`）。
   - 严禁包含系统命令拼接字符（如 `;`、`|`、`&`、`$`、反引号）。
5. **未知字段全面拦截**：
   - 传入任何未在 Schema 中定义的字段（例如试图附加私有配置或模型参数），写入将失败并报错 `INVALID_INPUT`。
