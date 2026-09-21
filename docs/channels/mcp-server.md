# MCP 协议服务器 (JSON-RPC)

除了登记外部 MCP 服务外，Portico 自身在 `8790` 端口上实现了一个纯纯只读的 **MCP Protocol Server**。这使得任何支持 MCP 协议的智能体（如 Claude Desktop、Cursor、Cline、Gemini 等）可以直接将 Portico 添加为 Tool Server，从而以结构化的方式感知组织内部的治理资产。

---

## 协议与传输规范

- **协议规范**：JSON-RPC 2.0。
- **传输层**：HTTP POST 请求（默认监听 `http://127.0.0.1:8790`）。
- **只读保证**：服务进程运行时严格无 `--allow-write` 文件写权限。

---

## 内置治理工具一览

Portico MCP 服务端暴露了 18 个经过安全收敛的只读治理工具：

| 工具名称 (Tool Name) | 参数说明 | 权限要求 | 功能描述 |
| :--- | :--- | :--- | :--- |
| **`portico_list`** | `{ channel?: string, state?: string }` | 匿名或持会话 | 查询当前可见的服务列表。匿名请求仅返回 `approved_public` 记录。 |
| **`portico_describe`** | `{ id: string }` | 匿名或持会话 | 查询指定服务的元数据与连接信息。若无权访问返回 NOT_FOUND。 |
| **`portico_entry`** | `{ id: string, channel?: string }` | 匿名或持会话 | 获取特定渠道的直连端点或包坐标。 |
| **`portico_mcp`** | `{}` | 匿名或持会话 | 列出当前身份可见的 MCP 连接信息。与 CLI `mcp list`、Portal `GET /api/mcp` 同一载荷。CLI 包坐标不会出现。匿名只看到已审批公开记录。不代理、不执行。 |
| **`portico_web`** | `{}` | 匿名或持会话 | 列出当前身份可见的 Web 直连入口。与 CLI `web list`、Portal `GET /api/web` 同一载荷。MCP 端点与 CLI 包坐标不会出现。匿名只看到已审批公开记录。不代理页面。 |
| **`portico_cli`** | `{}` | 匿名或持会话 | 列出当前身份可见的 CLI 包坐标。与 CLI `cli list`、Portal `GET /api/cli` 同一载荷。MCP 端点与 Web href 不会出现。匿名只看到已审批公开记录。不安装、不执行。 |
| **`portico_dashboard`**| `{}` | 匿名或持会话 | 获取系统资产大盘统计（服务总数、渠道分布、公开数）。 |
| **`portico_audience`** | `{ id: string }` | **维护者与人类审计者** | 单条记录在公开信任边界上的状态：记录自身声明的 `claimed`、读路径实际返回的 `served`、轨迹对该 surface 的最新一条 `decision`、匿名是否可达的 `reachable`，以及按 id 排序的名册受众（`{id,kind,role,reachable}`，角色来自名册，不含邮箱）。字节与轨迹不一致时给出 `mismatch`（`claimed_public_without_approval` / `approved_without_public_record`），两种情况下 `reachable` 都是 `false`。与 CLI `catalog audience`、Portal `GET /api/audience/<id>` 同一载荷。只读与匿名返回 `FORBIDDEN`，草稿对审计者返回 `NOT_FOUND`。只读：不写目录、不追加审批记录，也不是批准入口。 |
| **`portico_boundary`** | `{}` | **维护者与人类审计者** | 整库巡检公开边界：现在真正暴露的入口清单（每条含 `entry` / `channels` / `version` 与它依据的那次审批的 `approvedBy` / `approvedAt`）、`counts`（`visible` / `public_face` / `claimed_public` / `approved` / `mismatched`）与全部不一致（`claimed_public_without_approval` / `approved_without_public_record`）。`counts.visible` 与调用者自己的 `portico_list` 条数一致，草稿对审计者仍不可见，也不进任何角色的暴露清单。与 CLI `catalog boundary`、Portal `GET /api/boundary` 同一载荷。只读与匿名返回 `FORBIDDEN`。只读：不写目录、不追加审批记录，也不是批准入口。 |
| **`portico_audit`** | `{ q?: string, kind?: string, action?: string, subject?: string, asOf?: string }` | **仅限人类审计者** | 查询审计时间线流水。`asOf` 是时间切片：只返回截至该时刻已经在轨迹里的记录（带时区的真实瞬时，如 `2026-09-21T12:00:00Z`；裸日期、无时区墙钟与 `now` 之类一律 `INVALID_INPUT`，窗口含边界），用来重建过去的状态而不是读快照。非审计者调用返回 `FORBIDDEN`（角色检查先于过滤器解析）。 |
| **`portico_audit_verify`** | `{}` | **仅限人类审计者** | 重算安全审计的封条链，报告每个环节是否与写入时一致：哪条记录被改写、被删除或链条断开，也会列出没有任何环节覆盖的记录（未封存）。等价于 CLI `audit verify` 与 Portal `GET /api/audit-verify`。非审计者返回 `FORBIDDEN`。只读：不写审计文件，也不修改任何记录；返回的 `tip` 是该链当前末端摘要，可与外部留存的摘要比对。 |
| **`portico_seal_anchors`** | `{}` | **仅限人类审计者** | 列出外部方保留的封条检查点：谁在何时钉住了每条链的末端摘要与长度。封条本身只能证明「链内部一致」；整条链被重写、尾部被截断时链仍然自洽，只有链外的检查点能把这两种情况区分出来。与 CLI `audit anchors`、Portal `GET /api/seal-anchors` 同一载荷，读同一个锚点文件。非审计者返回 `FORBIDDEN`。只读：钉新检查点只能经 CLI `audit anchor` 写入，Portal 与 MCP 无写权限。 |
| **`portico_conclusions`** | `{ subject?: string, scope?: string, verdict?: string, asOf?: string }` | **仅限人类审计者** | 列出人类审计者对登记表面的追加式安全结论。与 CLI `audit conclusions`、Portal `GET /api/conclusions` 同一载荷，读同一个结论文件。主体可以是目录记录 id，也可以是仓库级边界契约（`boundary:runtime-l0`、`boundary:public-redaction`），这类结论带 `gate` 字段指向回答它的门禁任务。维护者、只读与匿名返回 `FORBIDDEN`。非法枚举过滤器与非法 `asOf` 返回 `INVALID_INPUT`。只读：记录结论只能经 CLI `audit conclude` 写入，Portal 与 MCP 无写权限。 |
| **`portico_conclusion_standings`** | `{ subject?: string, scope?: string, verdict?: string, asOf?: string }` | **仅限人类审计者** | 人类审计对每个主体与审计范围**当前**的判定，从追加式结论轨迹推导：当前 `verdict` 与它来自的结论（`conclusionId` / `auditorId` / `at`）、上一条判定 `previousVerdict`（区分「曾被标记、后已清除」与「从未被标记」）、该主体与范围下结论总数与 `cleared` / `flagged` 计数、可选 `gate` 与 `note`。与 CLI `audit standings`、Portal `GET /api/conclusions/standings` 同一载荷，读同一个结论文件。过滤的是**当前判定**而不是轨迹：`verdict: "flagged"` 只返回现在仍被标记的主体。`asOf` 给的是那一刻的判定（该时刻之前写下的结论才算数，当时判 `flagged` 就是 `flagged`，即使后来被清除）。维护者、只读与匿名返回 `FORBIDDEN`。只读：不写结论文件、目录或审计轨迹，也不改变任何判定。 |
| **`portico_approvals`** | `{}` | 已登录会话；匿名为空列表 | 列出公开边界审批记录（通过 / 拒绝 / 撤回，含可选 `note`）。与 CLI `catalog approvals`、Portal `GET /api/approvals` 同一载荷。 |
| **`portico_identities`** | `{}` | **维护者与人类审计者** | 列出名册身份（id / kind / role，可选 email）。只读与匿名返回 `FORBIDDEN`。不返回凭证或会话。 |
| **`portico_grants`** | `{}` | **仅限人类审计者** | 列出追加式授权轨迹。与 CLI `identity grants`、Portal `GET /api/grants` 同一载荷。维护者、只读与匿名返回 `FORBIDDEN`。不返回凭证或会话。 |
| **`portico_revokes`** | `{}` | **仅限人类审计者** | 列出追加式身份撤回轨迹。与 CLI `identity revokes`、Portal `GET /api/revokes` 同一载荷。维护者、只读与匿名返回 `FORBIDDEN`。不返回凭证或会话。读操作不写名册。 |
| **`portico_whoami`** | `{}` | 已登录会话；匿名 `FORBIDDEN` | 返回当前已证明身份的 id / kind / role。与 CLI `identity whoami`、Portal `GET /api/whoami` 同一载荷。不返回邮箱、凭证或会话。 |
| **`portico_sessions`** | `{}` | **仅限人类审计者** | 列出登录会话轨迹（id / 主体 / 时间，作废则含 revokedAt）。与 CLI `identity sessions`、Portal `GET /api/sessions` 同一载荷。维护者、只读与匿名返回 `FORBIDDEN`。不返回令牌或哈希。 |
| **`portico_credentials`** | `{}` | **仅限人类审计者** | 列出登录凭证轨迹（id / 主体 / credentialRef / 签发者 / 时间，作废则含 revokedAt）。与 CLI `identity credentials`、Portal `GET /api/credentials` 同一载荷。维护者、只读与匿名返回 `FORBIDDEN`。不返回令牌或哈希。 |
| **`portico_credential_revokes`** | `{}` | **仅限人类审计者** | 列出追加式登录凭证作废轨迹。与 CLI `identity credential revokes`、Portal `GET /api/credential-revokes` 同一载荷。维护者、只读与匿名返回 `FORBIDDEN`。不返回令牌或哈希。读操作不写名册。 |
| **`portico_gateway_audit`** | `{}` | **仅限人类审计者** | 列出 Gateway 访问审计。与 CLI `gateway audit`、Portal `GET /api/gateway-audit` 同一载荷。维护者、只读与匿名返回 `FORBIDDEN`。读操作不写目录或审计文件。这不是授权入口，也不执行工具。 |
| **`portico_page`** | `{}` | 匿名或持会话 | 读取维护者排布的门户组件盒。与 CLI `page get`、Portal `GET /api/page` 同一载荷。匿名看不到内部卡片。读操作不写 page 或目录。 |

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
