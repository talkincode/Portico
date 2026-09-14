import type { AuditService } from "../audit/mod.ts";
import {
  type Actor,
  CatalogError,
  CatalogService,
  type Channel,
  dashboardFrom,
  ErrorCode,
  type GovernanceState,
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
 * Every tool is a thin, read-only projection of an existing CatalogService or
 * AuditService call, so visibility, approval and role rules cannot fork: an
 * MCP caller sees exactly what the same identity sees on the CLI and the
 * Portal. Nothing here executes, proxies or orchestrates anything — Portico
 * still does not run other people's tools.
 */

export interface McpTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export interface McpToolDeps {
  catalog: CatalogService;
  audit: AuditService;
}

const CHANNELS: readonly Channel[] = ["cli", "mcp", "web"];
const GOVERNANCE_STATES: readonly GovernanceState[] = [
  "draft",
  "internal",
  "pending_public",
  "approved_public",
  "rejected",
];

export const TOOLS: readonly McpTool[] = [
  {
    name: "portico_list",
    description:
      "列出当前身份可见的已登记 Agent 表面。可见性与 CLI `catalog list`、Portal `GET /api/catalog` 完全相同：内部记录对匿名不可见，公开记录只有审批通过后才出现。",
    inputSchema: {
      type: "object",
      properties: {
        channel: { type: "string", enum: [...CHANNELS], description: "只返回该渠道的表面" },
        governanceState: {
          type: "string",
          enum: [...GOVERNANCE_STATES],
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
      "治理概览：当前身份可见的记录数与各治理状态计数。等价于 Portal `GET /api/dashboard`。这不是运行指标大盘。",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "portico_audit",
    description:
      "人类安全审计时间线（目录变更、授权、撤回、凭证作废、公开审批，以及可选的 Gateway 访问审计）。仅人类审计者可读；其他身份得到 FORBIDDEN。",
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
      const channel = optionalChannel(input.channel);
      const state = optionalGovernanceState(input.governanceState);
      const surfaces = await deps.catalog.list(actor);
      return surfaces.filter((surface) =>
        (channel === undefined || surface.channels.includes(channel)) &&
        (state === undefined || surface.governanceState === state)
      );
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
    case "portico_audit":
      return await deps.audit.list(actor);
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

function optionalChannel(value: unknown): Channel | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || !CHANNELS.includes(value as Channel)) {
    throw new CatalogError(
      ErrorCode.INVALID_INPUT,
      `channel must be one of: ${CHANNELS.join(", ")}`,
    );
  }
  return value as Channel;
}

function optionalGovernanceState(value: unknown): GovernanceState | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || !GOVERNANCE_STATES.includes(value as GovernanceState)) {
    throw new CatalogError(
      ErrorCode.INVALID_INPUT,
      `governanceState must be one of: ${GOVERNANCE_STATES.join(", ")}`,
    );
  }
  return value as GovernanceState;
}
