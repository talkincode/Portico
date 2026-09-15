import {
  applyAuditQuery,
  AUDIT_ACTIONS,
  AUDIT_KINDS,
  type AuditService,
  parseAuditQuery,
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
 * — Portico still does not run other people's tools.
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
      "列出公开边界上的审批记录（通过 / 拒绝 / 撤回）。等价于 CLI `catalog approvals` 与 Portal `GET /api/approvals`。已登录身份看到同一批记录与同一顺序；匿名得到空列表，不泄漏待审或已拒绝入口。读操作不写目录。",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "portico_identities",
    description:
      "列出当前名册中的身份（id / kind / role）。等价于 CLI `identity list` 与 Portal `GET /api/identities`。仅维护者与人类审计者可读；只读与匿名得到 FORBIDDEN。不返回凭证、会话或哈希。",
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
