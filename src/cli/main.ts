import { AccessService, FileIdentityStore, type GrantInput } from "../access/mod.ts";
import { AuditService } from "../audit/mod.ts";
import {
  type Actor,
  type ActorKind,
  type ActorRole,
  type ApprovalDecisionInput,
  CatalogError,
  CatalogService,
  ErrorCode,
  FileCatalogStore,
  type PublishInput,
  type RegisterInput,
} from "../catalog/mod.ts";
import { FileGatewayAuditStore, GatewayService } from "../gateway/mod.ts";
import { FilePageStore, PageService } from "../ui/mod.ts";

const USAGE = `portico <command>

Commands:
  identity grant    --identities <path> --id <id> --kind <human|agent> --role <reader|maintainer|auditor> [--actor-id <id> --actor-kind <human|agent> --actor-role <role>]
  identity list     --identities <path> --actor-id <id> --actor-kind <human|agent> --actor-role <role>
  identity grants   --identities <path> --actor-id <id> --actor-kind <human|agent> --actor-role <role>
  catalog register  --catalog <path> --identities <path> --actor-id <id> --actor-kind <human|agent> --actor-role <role> --input <file>
  catalog draft     --catalog <path> --identities <path> --actor-id <id> --actor-kind <human|agent> --actor-role <role> --input <file>
  catalog publish   --id <id> --visibility <internal|public> --catalog <path> --identities <path> --actor-id <id> --actor-kind <human|agent> --actor-role <role>
  catalog approve   --id <id> --catalog <path> --identities <path> --actor-id <id> --actor-kind <human|agent> --actor-role <role>
  catalog reject    --id <id> --catalog <path> --identities <path> --actor-id <id> --actor-kind <human|agent> --actor-role <role>
  catalog approvals --catalog <path> --identities <path> --actor-id <id> --actor-kind <human|agent> --actor-role <role>
  catalog list      --catalog <path> --identities <path> --actor-id <id> --actor-kind <human|agent> --actor-role <role>
  catalog get       --id <id> --catalog <path> --identities <path> --actor-id <id> --actor-kind <human|agent> --actor-role <role>
  mcp list          --catalog <path> --identities <path> --actor-id <id> --actor-kind <human|agent> --actor-role <role>
  mcp describe      --id <id> --catalog <path> --identities <path> --actor-id <id> --actor-kind <human|agent> --actor-role <role>
  gateway authorize --id <id> --catalog <path> --audit <path> --identities <path> --actor-id <id> --actor-kind <human|agent> --actor-role <role>
  gateway audit     --audit <path> --identities <path> --actor-id <id> --actor-kind <human|agent> --actor-role <role>
  audit list        --catalog <path> --identities <path> --actor-id <id> --actor-kind <human|agent> --actor-role <role> [--audit <path>]
  page set          --page <path> --catalog <path> --identities <path> --actor-id <id> --actor-kind <human|agent> --actor-role <role> --input <file>
  page get          --page <path> --catalog <path> --identities <path> --actor-id <id> --actor-kind <human|agent> --actor-role <role> [--audit <path>]

Catalog path may also be set with PORTICO_CATALOG_PATH.
Identity path may also be set with PORTICO_IDENTITIES_PATH.
Gateway audit path may also be set with PORTICO_GATEWAY_AUDIT_PATH.
Page path may also be set with PORTICO_PAGE_PATH.
Non-anonymous catalog commands resolve --actor-* against the identity roster.
The first identity grant may omit --actor-* and must be a human auditor.
The identity that submitted public cannot approve or reject the same request.
Output is always JSON.`;

interface CliResult {
  exitCode: number;
  stdout: string;
}

class UsageError extends Error {
  readonly code = ErrorCode.USAGE;
  constructor(message: string) {
    super(message);
    this.name = "UsageError";
  }
}

export async function runCli(
  args: string[],
  env: Record<string, string | undefined> = Deno.env.toObject(),
): Promise<CliResult> {
  try {
    const { positionals, flags } = parseArgs(args);
    if (flags.help === "true" || positionals.length === 0) {
      return ok({ usage: USAGE });
    }

    const [group, action] = positionals;
    if (group === "identity") {
      return await runIdentity(action, flags, env);
    }
    if (group === "mcp") {
      return await runMcp(action, flags, env);
    }
    if (group === "gateway") {
      return await runGateway(action, flags, env);
    }
    if (group === "audit") {
      return await runAudit(action, flags, env);
    }
    if (group === "page") {
      return await runPage(action, flags, env);
    }
    if (group !== "catalog") {
      throw new UsageError(`unknown command '${group}'`);
    }

    const claimed = readActor(flags);
    const catalogPath = flags.catalog ?? env.PORTICO_CATALOG_PATH;
    if (!catalogPath) {
      throw new UsageError("missing --catalog or PORTICO_CATALOG_PATH");
    }

    const actor = await resolveCatalogActor(claimed, flags, env);
    const service = new CatalogService(new FileCatalogStore(catalogPath));

    if (action === "register" || action === "draft") {
      if (!flags.input) throw new UsageError("missing --input");
      const raw = await Deno.readTextFile(flags.input);
      let payload: unknown;
      try {
        payload = JSON.parse(raw);
      } catch {
        throw new CatalogError(ErrorCode.INVALID_INPUT, "input file is not valid JSON");
      }
      const record = action === "draft"
        ? await service.draft(actor, payload as RegisterInput)
        : await service.register(actor, payload as RegisterInput);
      return ok(record);
    }

    if (action === "publish") {
      if (!flags.id) throw new UsageError("missing --id");
      if (!flags.visibility) throw new UsageError("missing --visibility");
      const payload: PublishInput = {
        id: flags.id,
        visibility: flags.visibility as PublishInput["visibility"],
      };
      return ok(await service.publish(actor, payload));
    }

    if (action === "approve" || action === "reject") {
      if (!flags.id) throw new UsageError("missing --id");
      const payload: ApprovalDecisionInput = { id: flags.id };
      return ok(
        action === "approve"
          ? await service.approve(actor, payload)
          : await service.reject(actor, payload),
      );
    }

    if (action === "approvals") {
      return ok(await service.listApprovals(actor));
    }

    if (action === "list") {
      return ok(await service.list(actor));
    }

    if (action === "get") {
      if (!flags.id) throw new UsageError("missing --id");
      return ok(await service.get(actor, flags.id));
    }

    throw new UsageError(action ? `unknown catalog action '${action}'` : "missing catalog action");
  } catch (error) {
    return fail(error);
  }
}

async function runMcp(
  action: string | undefined,
  flags: Record<string, string>,
  env: Record<string, string | undefined>,
): Promise<CliResult> {
  const claimed = readActor(flags);
  const catalogPath = flags.catalog ?? env.PORTICO_CATALOG_PATH;
  if (!catalogPath) {
    throw new UsageError("missing --catalog or PORTICO_CATALOG_PATH");
  }
  const actor = await resolveCatalogActor(claimed, flags, env);
  const service = new CatalogService(new FileCatalogStore(catalogPath));

  if (action === "list") {
    return ok(await service.listMcp(actor));
  }
  if (action === "describe") {
    if (!flags.id) throw new UsageError("missing --id");
    return ok(await service.describeMcp(actor, flags.id));
  }
  throw new UsageError(action ? `unknown mcp action '${action}'` : "missing mcp action");
}

async function runGateway(
  action: string | undefined,
  flags: Record<string, string>,
  env: Record<string, string | undefined>,
): Promise<CliResult> {
  const claimed = readActor(flags);
  const auditPath = flags.audit ?? env.PORTICO_GATEWAY_AUDIT_PATH;
  if (!auditPath) {
    throw new UsageError("missing --audit or PORTICO_GATEWAY_AUDIT_PATH");
  }

  if (action === "audit") {
    const actor = await resolveCatalogActor(claimed, flags, env);
    const gateway = new GatewayService(
      new CatalogService(new FileCatalogStore("")),
      new FileGatewayAuditStore(auditPath),
    );
    return ok(await gateway.listAudit(actor));
  }

  if (action === "authorize") {
    if (!flags.id) throw new UsageError("missing --id");
    const catalogPath = flags.catalog ?? env.PORTICO_CATALOG_PATH;
    if (!catalogPath) {
      throw new UsageError("missing --catalog or PORTICO_CATALOG_PATH");
    }
    const actor = await resolveCatalogActor(claimed, flags, env);
    const gateway = new GatewayService(
      new CatalogService(new FileCatalogStore(catalogPath)),
      new FileGatewayAuditStore(auditPath),
    );
    return ok(await gateway.authorize(actor, flags.id));
  }

  throw new UsageError(action ? `unknown gateway action '${action}'` : "missing gateway action");
}

async function runAudit(
  action: string | undefined,
  flags: Record<string, string>,
  env: Record<string, string | undefined>,
): Promise<CliResult> {
  if (action !== "list") {
    throw new UsageError(action ? `unknown audit action '${action}'` : "missing audit action");
  }
  const claimed = readActor(flags);
  const catalogPath = flags.catalog ?? env.PORTICO_CATALOG_PATH;
  if (!catalogPath) {
    throw new UsageError("missing --catalog or PORTICO_CATALOG_PATH");
  }
  const actor = await resolveCatalogActor(claimed, flags, env);
  const catalog = new CatalogService(new FileCatalogStore(catalogPath));
  const access = new AccessService(new FileIdentityStore(readIdentitiesPath(flags, env)));
  const auditPath = flags.audit ?? env.PORTICO_GATEWAY_AUDIT_PATH;
  const gateway = auditPath
    ? new GatewayService(catalog, new FileGatewayAuditStore(auditPath))
    : undefined;
  return ok(await new AuditService(catalog, access, gateway).list(actor));
}

async function runPage(
  action: string | undefined,
  flags: Record<string, string>,
  env: Record<string, string | undefined>,
): Promise<CliResult> {
  const claimed = readActor(flags);
  const pagePath = flags.page ?? env.PORTICO_PAGE_PATH;
  if (!pagePath) {
    throw new UsageError("missing --page or PORTICO_PAGE_PATH");
  }
  const catalogPath = flags.catalog ?? env.PORTICO_CATALOG_PATH;
  if (!catalogPath) {
    throw new UsageError("missing --catalog or PORTICO_CATALOG_PATH");
  }
  const actor = await resolveCatalogActor(claimed, flags, env);
  const catalog = new CatalogService(new FileCatalogStore(catalogPath));
  const access = new AccessService(new FileIdentityStore(readIdentitiesPath(flags, env)));
  const auditPath = flags.audit ?? env.PORTICO_GATEWAY_AUDIT_PATH;
  const audit = new AuditService(
    catalog,
    access,
    auditPath ? new GatewayService(catalog, new FileGatewayAuditStore(auditPath)) : undefined,
  );
  const pages = new PageService(new FilePageStore(pagePath), catalog, audit);

  if (action === "get") {
    return ok(await pages.get(actor));
  }
  if (action === "set") {
    if (!flags.input) throw new UsageError("missing --input");
    const raw = await Deno.readTextFile(flags.input);
    let payload: unknown;
    try {
      payload = JSON.parse(raw);
    } catch {
      throw new CatalogError(ErrorCode.INVALID_INPUT, "input file is not valid JSON");
    }
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
      throw new CatalogError(ErrorCode.INVALID_INPUT, "page payload must be an object");
    }
    return ok(await pages.set(actor, payload as Record<string, unknown>));
  }
  throw new UsageError(action ? `unknown page action '${action}'` : "missing page action");
}

async function runIdentity(
  action: string | undefined,
  flags: Record<string, string>,
  env: Record<string, string | undefined>,
): Promise<CliResult> {
  const identitiesPath = readIdentitiesPath(flags, env);
  const service = new AccessService(new FileIdentityStore(identitiesPath));

  if (action === "grant") {
    if (!flags.id) throw new UsageError("missing --id");
    if (!flags.kind) throw new UsageError("missing --kind");
    if (!flags.role) throw new UsageError("missing --role");
    const payload: GrantInput = {
      id: flags.id,
      kind: flags.kind as GrantInput["kind"],
      role: flags.role as GrantInput["role"],
    };
    return ok(await service.grant(tryReadActor(flags), payload));
  }

  const actor = readActor(flags);
  if (action === "list") {
    return ok(await service.list(actor));
  }
  if (action === "grants") {
    return ok(await service.listGrants(actor));
  }

  throw new UsageError(action ? `unknown identity action '${action}'` : "missing identity action");
}

async function resolveCatalogActor(
  claimed: Actor,
  flags: Record<string, string>,
  env: Record<string, string | undefined>,
): Promise<Actor> {
  if (claimed.role === "anonymous") return claimed;
  const identitiesPath = readIdentitiesPath(flags, env);
  const access = new AccessService(new FileIdentityStore(identitiesPath));
  return await access.resolve(claimed);
}

function readIdentitiesPath(
  flags: Record<string, string>,
  env: Record<string, string | undefined>,
): string {
  const path = flags.identities ?? env.PORTICO_IDENTITIES_PATH;
  if (!path) {
    throw new UsageError("missing --identities or PORTICO_IDENTITIES_PATH");
  }
  return path;
}

function tryReadActor(flags: Record<string, string>): Actor | null {
  if (!flags["actor-id"] && !flags["actor-kind"] && !flags["actor-role"]) {
    return null;
  }
  return readActor(flags);
}

function parseArgs(args: string[]): {
  positionals: string[];
  flags: Record<string, string>;
} {
  const positionals: string[] = [];
  const flags: Record<string, string> = {};
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--help" || arg === "-h") {
      flags.help = "true";
      continue;
    }
    if (arg.startsWith("--")) {
      const key = arg.slice(2);
      const value = args[i + 1];
      if (!value || value.startsWith("-")) {
        throw new UsageError(`flag --${key} requires a value`);
      }
      flags[key] = value;
      i += 1;
      continue;
    }
    positionals.push(arg);
  }
  return { positionals, flags };
}

function readActor(flags: Record<string, string>): Actor {
  const id = flags["actor-id"];
  const kind = flags["actor-kind"] as ActorKind | undefined;
  const role = flags["actor-role"] as ActorRole | undefined;
  if (!id || !kind || !role) {
    throw new UsageError("missing --actor-id, --actor-kind, or --actor-role");
  }
  return { id, kind, role };
}

function ok(data: unknown): CliResult {
  return { exitCode: 0, stdout: JSON.stringify({ ok: true, data }) };
}

function fail(error: unknown): CliResult {
  if (error instanceof CatalogError || error instanceof UsageError) {
    return {
      exitCode: 1,
      stdout: JSON.stringify({
        ok: false,
        error: { code: error.code, message: error.message },
      }),
    };
  }
  const message = error instanceof Error ? error.message : String(error);
  return {
    exitCode: 1,
    stdout: JSON.stringify({
      ok: false,
      error: { code: "INTERNAL", message },
    }),
  };
}

if (import.meta.main) {
  const result = await runCli(Deno.args);
  console.log(result.stdout);
  Deno.exit(result.exitCode);
}
