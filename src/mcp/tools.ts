import {
  applyAuditQuery,
  applyConclusionQuery,
  AUDIT_ACTIONS,
  AUDIT_KINDS,
  type AuditService,
  BOUNDARY_SUBJECTS,
  CONCLUSION_SCOPES,
  CONCLUSION_VERDICTS,
  type ConclusionService,
  parseAuditQuery,
  parseConclusionQuery,
} from "../audit/mod.ts";
import type { AccessService } from "../access/mod.ts";
import {
  type Actor,
  applyCatalogQuery,
  CATALOG_CHANNELS,
  CATALOG_GOVERNANCE_STATES,
  CatalogError,
  CatalogService,
  dashboardFrom,
  ErrorCode,
  parseCatalogQuery,
} from "../catalog/mod.ts";
import { type GatewayService, listGatewayAudit } from "../gateway/mod.ts";
import type { PageService } from "../ui/mod.ts";
import { isRecord } from "./types.ts";

/**
 * The read-only governance surface Portico exposes over MCP.
 *
 * `AGENTS.md` requires Portal, CLI and MCP to present the same governance
 * state, and `docs/roadmap.md` lists MCP as one of the three entrances. Until
 * now the "MCP entrance" was a registration category plus an authorize
 * endpoint — there was no MCP server at all, so an MCP client could discover
 * nothing. These tools close that gap.
 *
 * Every tool is a thin, read-only projection of an existing CatalogService,
 * AuditService or AccessService call, so visibility, approval and role rules
 * cannot fork: an MCP caller sees exactly what the same identity sees on the
 * CLI and the Portal. Nothing here executes, proxies or orchestrates anything
 * — Portico still does not run other people's tools. `portico_whoami` is the
 * current session identity, not a login. `portico_sessions` is the auditor
 * session trail, not a way to mint or revoke tokens. `portico_credentials`
 * is the auditor credential inventory, not a way to issue tokens.
 * `portico_credential_revokes` is the auditor credential-revoke trail, not a
 * way to invalidate tokens. `portico_revokes` is the auditor identity-revoke
 * trail, not a way to remove a roster identity. `portico_web` is authorized
 * Web hrefs, not a page proxy. `portico_cli` is authorized CLI package
 * coordinates, not an installer.
 */

export interface McpTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export interface McpToolDeps {
  catalog: CatalogService;
  audit: AuditService;
  access: AccessService;
  pages?: PageService;
  gateway?: GatewayService;
  /** Read-only: the MCP entrance never records a conclusion. */
  conclusions?: ConclusionService;
}

export const TOOLS: readonly McpTool[] = [
  {
    name: "portico_list",
    description:
      "列出当前身份可见的已登记 Agent 表面。可见性与 CLI `catalog list`、Portal `GET /api/catalog` 完全相同：内部记录对匿名不可见，公开记录只有审批通过后才出现。",
    inputSchema: {
      type: "object",
      properties: {
        q: {
          type: "string",
          description: "在当前身份可见的 id / 名称 / 说明里做子串过滤；不搜索入口 URL 或包坐标",
        },
        channel: {
          type: "string",
          enum: [...CATALOG_CHANNELS],
          description: "只返回该渠道的表面",
        },
        governanceState: {
          type: "string",
          enum: [...CATALOG_GOVERNANCE_STATES],
          description: "只返回该治理状态的表面",
        },
      },
      additionalProperties: false,
    },
  },
  {
    name: "portico_describe",
    description:
      "按 id 读取一条可见的登记，含维护者、治理状态与入口引用。等价于 CLI `catalog get`。不可见的记录返回 NOT_FOUND，不泄漏其存在。",
    inputSchema: {
      type: "object",
      properties: { id: { type: "string", description: "登记 id（小写 kebab-case）" } },
      required: ["id"],
      additionalProperties: false,
    },
  },
  {
    name: "portico_entry",
    description:
      "取某条登记在当前身份下被授权的入口：Web 返回直连 href，CLI 返回包坐标，MCP 返回 endpoint，均为 connect.mode=`direct` 或 `coordinate`。Portico 不代理流量、不安装包。等价于 CLI 的 `mcp describe` / `web describe` / `cli describe`。",
    inputSchema: {
      type: "object",
      properties: { id: { type: "string", description: "登记 id（小写 kebab-case）" } },
      required: ["id"],
      additionalProperties: false,
    },
  },
  {
    name: "portico_mcp",
    description:
      "列出当前身份可见的 MCP 连接信息（endpoint 与 connect.mode=`direct`）。等价于 CLI `mcp list` 与 Portal `GET /api/mcp`。CLI 包坐标不会出现。匿名只看到已审批公开记录。Portico 不代理流量、不执行工具。",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "portico_web",
    description:
      "列出当前身份可见的 Web 直连入口（href 与 connect.mode=`direct`）。等价于 CLI `web list` 与 Portal `GET /api/web`。MCP 端点与 CLI 包坐标不会出现。匿名只看到已审批公开记录。Portico 不代理页面、不抓取远程 HTML。",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "portico_cli",
    description:
      "列出当前身份可见的 CLI 包坐标（package 与 connect.mode=`coordinate`）。等价于 CLI `cli list` 与 Portal `GET /api/cli`。MCP 端点与 Web href 不会出现。匿名只看到已审批公开记录。Portico 不安装、不执行、不下载该包。",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "portico_dashboard",
    description:
      "治理概览：当前身份可见的记录数与各治理状态计数。等价于 CLI `catalog dashboard` 与 Portal `GET /api/dashboard`。这不是运行指标大盘。",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "portico_audit",
    description:
      "人类安全审计时间线（目录变更、授权、撤回、凭证作废、公开审批，以及可选的 Gateway 访问审计）。仅人类审计者可读；其他身份得到 FORBIDDEN。过滤与 CLI `audit list`、Portal `GET /api/audit` 相同：不搜索入口 URL。",
    inputSchema: {
      type: "object",
      properties: {
        q: {
          type: "string",
          description:
            "在当前时间线的 id / 主体 / 摘要 / 动作里做子串过滤；不搜索入口 URL 或包坐标",
        },
        kind: {
          type: "string",
          enum: [...AUDIT_KINDS],
          description: "只返回该种类的审计事件",
        },
        action: {
          type: "string",
          enum: [...AUDIT_ACTIONS],
          description: "只返回该动作的审计事件",
        },
        subject: {
          type: "string",
          description: "只返回该 subjectId 的事件（精确匹配）",
        },
      },
      additionalProperties: false,
    },
  },
  {
    name: "portico_approvals",
    description:
      "列出公开边界上的审批记录（通过 / 拒绝 / 撤回，含可选 note）。等价于 CLI `catalog approvals` 与 Portal `GET /api/approvals`。已登录身份看到同一批记录与同一顺序；匿名得到空列表，不泄漏待审、已拒绝入口或备注。读操作不写目录。这不是批准入口。",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "portico_identities",
    description:
      "列出当前名册中的身份（id / kind / role）。等价于 CLI `identity list` 与 Portal `GET /api/identities`。仅维护者与人类审计者可读；只读与匿名得到 FORBIDDEN。不返回凭证、会话或哈希。",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "portico_grants",
    description:
      "列出追加式授权轨迹（谁在何时授予了哪个角色）。等价于 CLI `identity grants` 与 Portal `GET /api/grants`。仅人类审计者可读；维护者、只读与匿名得到 FORBIDDEN。不返回凭证、会话或哈希。读操作不写名册。",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "portico_revokes",
    description:
      "列出追加式身份撤回轨迹（谁在何时撤回了哪个角色）。等价于 CLI `identity revokes` 与 Portal `GET /api/revokes`。仅人类审计者可读；维护者、只读与匿名得到 FORBIDDEN。不返回凭证、会话或哈希。读操作不写名册。",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "portico_whoami",
    description:
      "返回当前已证明身份的 id / kind / role。等价于 CLI `identity whoami` 与 Portal `GET /api/whoami`。已登录会话看到自己；匿名得到 FORBIDDEN。不返回邮箱、凭证或会话。读操作不写名册。",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "portico_sessions",
    description:
      "列出登录会话轨迹（id / 主体 / 创建与过期时间，作废则含 revokedAt）。等价于 CLI `identity sessions` 与 Portal `GET /api/sessions`。仅人类审计者可读；维护者、只读与匿名得到 FORBIDDEN。不返回令牌或哈希。读操作不写会话文件。",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "portico_credentials",
    description:
      "列出登录凭证轨迹（id / 主体 / credentialRef / 签发者 / 时间，作废则含 revokedAt）。等价于 CLI `identity credentials` 与 Portal `GET /api/credentials`。仅人类审计者可读；维护者、只读与匿名得到 FORBIDDEN。不返回令牌或哈希。读操作不写会话文件。",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "portico_credential_revokes",
    description:
      "列出追加式登录凭证作废轨迹（谁在何时作废了哪个主体的凭证与会话）。等价于 CLI `identity credential revokes` 与 Portal `GET /api/credential-revokes`。仅人类审计者可读；维护者、只读与匿名得到 FORBIDDEN。不返回令牌或哈希。读操作不写名册或会话文件。",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "portico_gateway_audit",
    description:
      "列出 Gateway 访问审计（允许与拒绝的直连授权）。等价于 CLI `gateway audit` 与 Portal `GET /api/gateway-audit`。仅人类审计者可读；维护者、只读与匿名得到 FORBIDDEN。读操作不写目录或审计文件。这不是授权入口，也不执行工具。",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "portico_conclusions",
    description:
      `列出人类审计者记录的追加式安全审计结论（主体 / 审计范围 / 判定 / 审计者 / 时间 / 可选说明）。等价于 CLI \`audit conclusions\` 与 Portal \`GET /api/conclusions\`。审计范围是公开边界、入口指向、权限变化、密钥泄漏、运行时边界（L0）或网关越权之一。主体可以是目录记录 id，也可以是仓库级边界契约（${
        BOUNDARY_SUBJECTS.map((item) => item.id).join(" / ")
      }，这类结论带 \`gate\` 字段，指向回答它的门禁任务）。仅人类审计者可读；维护者、只读与匿名得到 FORBIDDEN。读操作不写结论文件或目录。这不是记录入口：结论由 CLI \`audit conclude\` 写入，Portal 与 MCP 只读。`,
    inputSchema: {
      type: "object",
      properties: {
        subject: {
          type: "string",
          description: "只返回该主体的结论（目录记录 id 或边界契约 id）",
        },
        scope: {
          type: "string",
          enum: [...CONCLUSION_SCOPES],
          description: "只返回该审计范围的结论",
        },
        verdict: {
          type: "string",
          enum: [...CONCLUSION_VERDICTS],
          description: "只返回该判定的结论",
        },
      },
      additionalProperties: false,
    },
  },
  {
    name: "portico_page",
    description:
      "读取维护者排布的门户组件盒（当前身份可见的卡片与提示）。等价于 CLI `page get` 与 Portal `GET /api/page`。匿名看不到内部卡片；读操作不写 page 或目录。Portico 不是 CMS，不能通过此工具改页面。",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
];

export function isTool(name: string): boolean {
  return TOOLS.some((tool) => tool.name === name);
}

export async function callTool(
  actor: Actor,
  name: string,
  args: unknown,
  deps: McpToolDeps,
): Promise<unknown> {
  const input = readArguments(args);
  switch (name) {
    case "portico_list": {
      const query = parseCatalogQuery(input);
      return applyCatalogQuery(await deps.catalog.list(actor), query);
    }
    case "portico_describe":
      return await deps.catalog.get(actor, requireId(input.id));
    case "portico_entry": {
      const id = requireId(input.id);
      const record = await deps.catalog.get(actor, id);
      const [channel] = record.channels;
      if (record.channels.length === 1 && channel === "mcp") {
        return await deps.catalog.describeMcp(actor, id);
      }
      if (record.channels.length === 1 && channel === "web") {
        return await deps.catalog.describeWeb(actor, id);
      }
      if (record.channels.length === 1 && channel === "cli") {
        return await deps.catalog.describeCli(actor, id);
      }
      throw new CatalogError(
        ErrorCode.NOT_FOUND,
        `surface '${id}' has no single authorized entry`,
      );
    }
    case "portico_mcp":
      return await deps.catalog.listMcp(actor);
    case "portico_web":
      return await deps.catalog.listWeb(actor);
    case "portico_cli":
      return await deps.catalog.listCli(actor);
    case "portico_dashboard":
      return dashboardFrom(await deps.catalog.list(actor));
    case "portico_audit": {
      const events = await deps.audit.list(actor);
      return applyAuditQuery(events, parseAuditQuery(input));
    }
    case "portico_approvals":
      return await deps.catalog.listApprovals(actor);
    case "portico_identities":
      return await deps.access.list(actor);
    case "portico_grants":
      return await deps.access.listGrants(actor);
    case "portico_revokes":
      return await deps.access.listRevokes(actor);
    case "portico_whoami":
      return await deps.access.whoami(actor);
    case "portico_sessions":
      return await deps.access.listSessions(actor);
    case "portico_credentials":
      return await deps.access.listCredentials(actor);
    case "portico_credential_revokes":
      return await deps.access.listCredentialRevokes(actor);
    case "portico_gateway_audit":
      return await listGatewayAudit(deps.gateway, actor);
    case "portico_conclusions": {
      if (!deps.conclusions) return [];
      // Role check first, filter second — same order as `portico_audit`, so a
      // non-auditor cannot probe the filter grammar.
      const records = await deps.conclusions.list(actor);
      return applyConclusionQuery(records, parseConclusionQuery(input));
    }
    case "portico_page":
      if (!deps.pages) return { components: [] };
      return await deps.pages.get(actor);
    default:
      throw new CatalogError(ErrorCode.NOT_FOUND, `unknown tool '${name}'`);
  }
}

function readArguments(args: unknown): Record<string, unknown> {
  if (args === undefined) return {};
  if (!isRecord(args)) {
    throw new CatalogError(ErrorCode.INVALID_INPUT, "tool arguments must be an object");
  }
  return args;
}

function requireId(value: unknown): string {
  if (typeof value !== "string" || !value) {
    throw new CatalogError(ErrorCode.INVALID_INPUT, "id is required");
  }
  return value;
}
