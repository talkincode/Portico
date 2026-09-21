import {
  AccessService,
  FileIdentityStore,
  FileSessionStore,
  type GrantInput,
} from "../access/mod.ts";
import {
  AnchorService,
  applyAuditQuery,
  applyConclusionQuery,
  AuditService,
  BOUNDARY_SUBJECTS,
  CONCLUSION_SCOPES,
  type ConclusionInput,
  ConclusionService,
  FileAnchorStore,
  FileConclusionStore,
  parseAuditQuery,
  parseConclusionQuery,
  SealService,
} from "../audit/mod.ts";
import {
  type Actor,
  type ActorKind,
  type ActorRole,
  applyCatalogQuery,
  type ApprovalDecisionInput,
  audienceReport,
  boundarySweep,
  CatalogError,
  CatalogService,
  dashboardFrom,
  ErrorCode,
  FileCatalogStore,
  parseCatalogQuery,
  type PublishInput,
  type RegisterInput,
  type UpdateInput,
} from "../catalog/mod.ts";
import { FileGatewayAuditStore, GatewayService } from "../gateway/mod.ts";
import { FilePageStore, PageService } from "../ui/mod.ts";

const SCOPE_ARG = CONCLUSION_SCOPES.join("|");

const USAGE = `portico <command>

Commands:
  identity grant    --identities <path> --id <id> --kind <human|agent> --role <reader|maintainer|auditor> [--email <address>] [--session <token> --sessions <path>]
  identity revoke   --identities <path> --id <id> --session <token> --sessions <path>
  identity list     --identities <path> [--session <token> --sessions <path>]
  identity grants   --identities <path> --session <token> --sessions <path>
  identity revokes  --identities <path> --session <token> --sessions <path>
  identity sessions --identities <path> --session <token> --sessions <path>
  identity credentials --identities <path> --session <token> --sessions <path>
  identity credential issue --identities <path> --sessions <path> --id <subject> [--session <token>]
  identity credential revoke --identities <path> --sessions <path> --id <subject> --session <token>
  identity credential revokes --identities <path> --session <token> --sessions <path>
  identity login    --identities <path> --sessions <path> --id <id> --token <issued>
  identity logout   --identities <path> --sessions <path> --session <token>
  identity whoami   --identities <path> --sessions <path> --session <token>
  catalog register  --catalog <path> --identities <path> --session <token> --sessions <path> --input <file>
  catalog draft     --catalog <path> --identities <path> --session <token> --sessions <path> --input <file>
  catalog publish   --id <id> --visibility <internal|public> --catalog <path> --identities <path> --session <token> --sessions <path>
  catalog update    --id <id> --catalog <path> --identities <path> --session <token> --sessions <path> --input <file>
  catalog approve   --id <id> --catalog <path> --identities <path> --session <token> --sessions <path> [--note <text>]
  catalog reject    --id <id> --catalog <path> --identities <path> --session <token> --sessions <path> [--note <text>]
  catalog withdraw  --id <id> --catalog <path> --identities <path> --session <token> --sessions <path> [--note <text>]
  catalog approvals --catalog <path> --identities <path> --session <token> --sessions <path>
  catalog dashboard --catalog <path> --identities <path> --session <token> --sessions <path>
  catalog audience  --id <id> --catalog <path> --identities <path> --session <token> --sessions <path>
  catalog boundary  --catalog <path> --identities <path> --session <token> --sessions <path>
  catalog list      --catalog <path> --identities <path> --session <token> --sessions <path> [--q <text>] [--channel cli|mcp|web] [--state draft|internal|pending_public|approved_public|rejected]
  catalog get       --id <id> --catalog <path> --identities <path> --session <token> --sessions <path>
  mcp list          --catalog <path> --identities <path> --session <token> --sessions <path>
  mcp describe      --id <id> --catalog <path> --identities <path> --session <token> --sessions <path>
  web list          --catalog <path> --identities <path> --session <token> --sessions <path>
  web describe      --id <id> --catalog <path> --identities <path> --session <token> --sessions <path>
  cli list          --catalog <path> --identities <path> --session <token> --sessions <path>
  cli describe      --id <id> --catalog <path> --identities <path> --session <token> --sessions <path>
  gateway authorize --id <id> --catalog <path> --audit <path> --identities <path> --session <token> --sessions <path>
  gateway audit     --audit <path> --identities <path> --session <token> --sessions <path>
  audit verify      --catalog <path> --identities <path> --session <token> --sessions <path> [--audit <path>] [--conclusions <path>] [--anchors <path>]
  audit list        --catalog <path> --identities <path> --session <token> --sessions <path> [--audit <path>] [--q <text>] [--kind catalog|grant|revoke|credential|approval|gateway] [--action grant|revoke|revoke_credential|register|draft|publish_internal|publish_public_candidate|update|approved|rejected|withdrawn|allowed|denied] [--subject <id>]
  audit conclude    --conclusions <path> --catalog <path> --identities <path> --session <token> --sessions <path> --id <id> --scope ${SCOPE_ARG} --verdict cleared|flagged [--note <text>]
  audit conclusions --conclusions <path> --catalog <path> --identities <path> --session <token> --sessions <path> [--subject <id>] [--scope ${SCOPE_ARG}] [--verdict cleared|flagged]
  audit anchor      --anchors <path> --catalog <path> --identities <path> --session <token> --sessions <path> [--audit <path>] [--conclusions <path>]
  audit anchors     --anchors <path> --catalog <path> --identities <path> --session <token> --sessions <path>
  page set          --page <path> --catalog <path> --identities <path> --session <token> --sessions <path> --input <file>
  page get          --page <path> --catalog <path> --identities <path> --session <token> --sessions <path> [--audit <path>]

Catalog path may also be set with PORTICO_CATALOG_PATH.
Identity path may also be set with PORTICO_IDENTITIES_PATH.
Session path may also be set with PORTICO_SESSIONS_PATH.
Gateway audit path may also be set with PORTICO_GATEWAY_AUDIT_PATH.
Conclusion path may also be set with PORTICO_CONCLUSIONS_PATH.
Seal anchor path may also be set with PORTICO_SEAL_ANCHORS_PATH.
Without an anchor path, audit verify reports every pillar as unanchored
(count 0), because nothing outside the pillar files then agrees on the tips;
a rewrite of a whole chain and a truncation of its tail are invisible to the
seal alone, and the anchors are what make them visible.
Page path may also be set with PORTICO_PAGE_PATH.
A non-anonymous command proves its identity with --session; --actor-* alone is
refused (USAGE). With no identity flags at all a command runs as anonymous.
The first identity grant and the first credential issue need no session.
Issued credential and session tokens are printed once and stored as hashes.
The first identity grant needs no session and must be a human auditor.
The first credential issue is the one-time bootstrap and needs no session.
An identity cannot revoke itself; the last human auditor cannot be revoked.
Revoking credentials invalidates login tokens and sessions without removing the roster identity.
The identity that submitted public cannot approve or reject the same request.
A repository boundary contract has no catalog record; conclude on it by id with
the scope it declares:
${
  BOUNDARY_SUBJECTS.map((item) =>
    `  ${item.id} --scope ${item.scope} (gate: deno task ${item.gate})`
  )
    .join("\n")
}
Approve, reject and withdraw accept an optional --note (at most 500 characters,
no control characters); it is stored on the approval record and returned by
catalog approvals / GET /api/approvals / portico_approvals.
Withdrawing an approved public surface is reserved for a human auditor.
A pending public candidate or an approved public surface cannot be updated
directly; reject or withdraw it first, then update, then resubmit for approval.
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

    const [group, action, subaction] = positionals;
    if (group === "identity") {
      return await runIdentity(action, flags, env, subaction);
    }
    if (group === "mcp") {
      return await runMcp(action, flags, env);
    }
    if (group === "web") {
      return await runWeb(action, flags, env);
    }
    if (group === "cli") {
      return await runCliChannel(action, flags, env);
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

    const catalogPath = flags.catalog ?? env.PORTICO_CATALOG_PATH;
    if (!catalogPath) {
      throw new UsageError("missing --catalog or PORTICO_CATALOG_PATH");
    }

    const actor = await resolveFlagsActor(flags, env);
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

    if (action === "update") {
      if (!flags.id) throw new UsageError("missing --id");
      if (!flags.input) throw new UsageError("missing --input");
      const raw = await Deno.readTextFile(flags.input);
      let payload: unknown;
      try {
        payload = JSON.parse(raw);
      } catch {
        throw new CatalogError(ErrorCode.INVALID_INPUT, "input file is not valid JSON");
      }
      if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
        throw new CatalogError(ErrorCode.INVALID_INPUT, "update payload must be an object");
      }
      const merged: UpdateInput = { ...(payload as Record<string, unknown>), id: flags.id };
      return ok(await service.update(actor, merged));
    }

    if (action === "approve" || action === "reject") {
      if (!flags.id) throw new UsageError("missing --id");
      const payload: ApprovalDecisionInput = { id: flags.id };
      if (flags.note !== undefined) payload.note = flags.note;
      return ok(
        action === "approve"
          ? await service.approve(actor, payload)
          : await service.reject(actor, payload),
      );
    }

    if (action === "withdraw") {
      if (!flags.id) throw new UsageError("missing --id");
      const payload: ApprovalDecisionInput = { id: flags.id };
      if (flags.note !== undefined) payload.note = flags.note;
      return ok(await service.withdraw(actor, payload));
    }

    if (action === "approvals") {
      return ok(await service.listApprovals(actor));
    }

    if (action === "dashboard") {
      return ok(dashboardFrom(await service.list(actor)));
    }

    if (action === "audience") {
      if (!flags.id) throw new UsageError("missing --id");
      const access = new AccessService(
        new FileIdentityStore(readIdentitiesPath(flags, env)),
      );
      return ok(await audienceReport(service, access, actor, flags.id));
    }

    if (action === "boundary") {
      const access = new AccessService(
        new FileIdentityStore(readIdentitiesPath(flags, env)),
      );
      return ok(await boundarySweep(service, access, actor));
    }

    if (action === "list") {
      const query = parseCatalogQuery({
        q: flags.q,
        channel: flags.channel,
        state: flags.state,
      });
      return ok(applyCatalogQuery(await service.list(actor), query));
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
  const catalogPath = flags.catalog ?? env.PORTICO_CATALOG_PATH;
  if (!catalogPath) {
    throw new UsageError("missing --catalog or PORTICO_CATALOG_PATH");
  }
  const actor = await resolveFlagsActor(flags, env);
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

async function runWeb(
  action: string | undefined,
  flags: Record<string, string>,
  env: Record<string, string | undefined>,
): Promise<CliResult> {
  const catalogPath = flags.catalog ?? env.PORTICO_CATALOG_PATH;
  if (!catalogPath) {
    throw new UsageError("missing --catalog or PORTICO_CATALOG_PATH");
  }
  const actor = await resolveFlagsActor(flags, env);
  const service = new CatalogService(new FileCatalogStore(catalogPath));

  if (action === "list") {
    return ok(await service.listWeb(actor));
  }
  if (action === "describe") {
    if (!flags.id) throw new UsageError("missing --id");
    return ok(await service.describeWeb(actor, flags.id));
  }
  throw new UsageError(action ? `unknown web action '${action}'` : "missing web action");
}

async function runCliChannel(
  action: string | undefined,
  flags: Record<string, string>,
  env: Record<string, string | undefined>,
): Promise<CliResult> {
  const catalogPath = flags.catalog ?? env.PORTICO_CATALOG_PATH;
  if (!catalogPath) {
    throw new UsageError("missing --catalog or PORTICO_CATALOG_PATH");
  }
  const actor = await resolveFlagsActor(flags, env);
  const service = new CatalogService(new FileCatalogStore(catalogPath));

  if (action === "list") {
    return ok(await service.listCli(actor));
  }
  if (action === "describe") {
    if (!flags.id) throw new UsageError("missing --id");
    return ok(await service.describeCli(actor, flags.id));
  }
  throw new UsageError(action ? `unknown cli action '${action}'` : "missing cli action");
}

async function runGateway(
  action: string | undefined,
  flags: Record<string, string>,
  env: Record<string, string | undefined>,
): Promise<CliResult> {
  const auditPath = flags.audit ?? env.PORTICO_GATEWAY_AUDIT_PATH;
  if (!auditPath) {
    throw new UsageError("missing --audit or PORTICO_GATEWAY_AUDIT_PATH");
  }

  if (action === "audit") {
    const actor = await resolveFlagsActor(flags, env);
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
    const actor = await resolveFlagsActor(flags, env);
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
  if (
    action !== "list" && action !== "verify" && action !== "conclude" &&
    action !== "conclusions" && action !== "anchor" && action !== "anchors"
  ) {
    throw new UsageError(action ? `unknown audit action '${action}'` : "missing audit action");
  }
  const catalogPath = flags.catalog ?? env.PORTICO_CATALOG_PATH;
  if (!catalogPath) {
    throw new UsageError("missing --catalog or PORTICO_CATALOG_PATH");
  }
  const actor = await resolveFlagsActor(flags, env);
  const catalog = new CatalogService(new FileCatalogStore(catalogPath));

  if (action === "conclude" || action === "conclusions") {
    const conclusionsPath = flags.conclusions ?? env.PORTICO_CONCLUSIONS_PATH;
    if (!conclusionsPath) {
      throw new UsageError("missing --conclusions or PORTICO_CONCLUSIONS_PATH");
    }
    const conclusions = new ConclusionService(
      new FileConclusionStore(conclusionsPath),
      catalog,
    );
    if (action === "conclusions") {
      // Role check first, filter second — same order as `audit list`.
      const records = await conclusions.list(actor);
      const query = parseConclusionQuery({
        subject: flags.subject,
        scope: flags.scope,
        verdict: flags.verdict,
      });
      return ok(applyConclusionQuery(records, query));
    }
    if (!flags.id) throw new UsageError("missing --id");
    if (!flags.scope) throw new UsageError("missing --scope");
    if (!flags.verdict) throw new UsageError("missing --verdict");
    const payload: ConclusionInput = {
      id: flags.id,
      scope: flags.scope as ConclusionInput["scope"],
      verdict: flags.verdict as ConclusionInput["verdict"],
    };
    if (flags.note !== undefined) payload.note = flags.note;
    return ok(await conclusions.record(actor, payload));
  }

  const access = new AccessService(new FileIdentityStore(readIdentitiesPath(flags, env)));
  const auditPath = flags.audit ?? env.PORTICO_GATEWAY_AUDIT_PATH;
  const gateway = auditPath
    ? new GatewayService(catalog, new FileGatewayAuditStore(auditPath))
    : undefined;

  // The seal-facing actions share one construction. Conclusions and anchors
  // are optional files, and an absent anchors file is exactly what "no
  // checkpoint was ever taken" looks like, so `audit verify` stays usable
  // without one — every pillar then reports anchored: 0 rather than verified.
  const conclusionsPath = flags.conclusions ?? env.PORTICO_CONCLUSIONS_PATH;
  const conclusions = conclusionsPath
    ? new ConclusionService(new FileConclusionStore(conclusionsPath), catalog)
    : undefined;
  const anchorsPath = flags.anchors ?? env.PORTICO_SEAL_ANCHORS_PATH;
  const anchors = anchorsPath ? new FileAnchorStore(anchorsPath) : undefined;
  const seals = new SealService(catalog, access, gateway, conclusions, anchors);

  if (action === "verify") {
    // Role check first: the seal report names records, so only an auditor may
    // ask for it — same gate as `audit list`.
    return ok(await seals.report(actor));
  }

  if (action === "anchor" || action === "anchors") {
    // Taking a checkpoint changes state, so it needs a real path instead of
    // succeeding against nothing.
    if (!anchors) {
      throw new UsageError("missing --anchors or PORTICO_SEAL_ANCHORS_PATH");
    }
    const service = new AnchorService(anchors, seals);
    return ok(action === "anchor" ? await service.anchor(actor) : await service.list(actor));
  }

  const events = await new AuditService(catalog, access, gateway).list(actor);
  const query = parseAuditQuery({
    q: flags.q,
    kind: flags.kind,
    action: flags.action,
    subject: flags.subject,
  });
  return ok(applyAuditQuery(events, query));
}

async function runPage(
  action: string | undefined,
  flags: Record<string, string>,
  env: Record<string, string | undefined>,
): Promise<CliResult> {
  const pagePath = flags.page ?? env.PORTICO_PAGE_PATH;
  if (!pagePath) {
    throw new UsageError("missing --page or PORTICO_PAGE_PATH");
  }
  const catalogPath = flags.catalog ?? env.PORTICO_CATALOG_PATH;
  if (!catalogPath) {
    throw new UsageError("missing --catalog or PORTICO_CATALOG_PATH");
  }
  const actor = await resolveFlagsActor(flags, env);
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
  subaction?: string,
): Promise<CliResult> {
  const service = openAccess(flags, env, needsSessionStore(action, subaction));

  if (action === "grant") {
    if (!flags.id) throw new UsageError("missing --id");
    if (!flags.kind) throw new UsageError("missing --kind");
    if (!flags.role) throw new UsageError("missing --role");
    const payload: GrantInput = {
      id: flags.id,
      kind: flags.kind as GrantInput["kind"],
      role: flags.role as GrantInput["role"],
    };
    if (flags.email !== undefined) payload.email = flags.email;
    return ok(await service.grant(await tryResolveActor(flags, env), payload));
  }

  if (action === "revoke") {
    if (!flags.id) throw new UsageError("missing --id");
    const actor = await resolveFlagsActor(flags, env);
    return ok(await service.revoke(actor, { id: flags.id }));
  }

  if (action === "credential") {
    if (subaction === "revokes") {
      const actor = await resolveFlagsActor(flags, env);
      return ok(await service.listCredentialRevokes(actor));
    }
    if (subaction !== "issue" && subaction !== "revoke") {
      throw new UsageError(
        subaction ? `unknown credential action '${subaction}'` : "missing credential action",
      );
    }
    if (!flags.id) throw new UsageError("missing --id");
    if (subaction === "revoke") {
      const actor = await resolveFlagsActor(flags, env);
      return ok(await service.revokeCredentials(actor, { id: flags.id }));
    }
    // No session may mean the one-time bootstrap; the service decides.
    return ok(await service.issueCredential(await tryResolveActor(flags, env), { id: flags.id }));
  }

  if (action === "login") {
    if (!flags.id) throw new UsageError("missing --id");
    if (!flags.token) throw new UsageError("missing --token");
    const ttlRaw = flags["ttl-seconds"];
    const ttlSeconds = ttlRaw === undefined ? undefined : Number(ttlRaw);
    if (ttlRaw !== undefined && !Number.isInteger(ttlSeconds)) {
      throw new UsageError("--ttl-seconds must be an integer");
    }
    return ok(await service.login({ id: flags.id, token: flags.token, ttlSeconds }));
  }

  if (action === "logout") {
    return ok(await service.logout(readSessionToken(flags, env)));
  }

  if (action === "whoami") {
    return ok(await service.whoami(await service.resolveSession(readSessionToken(flags, env))));
  }

  const actor = await resolveFlagsActor(flags, env);
  if (action === "list") {
    return ok(await service.list(actor));
  }
  if (action === "grants") {
    return ok(await service.listGrants(actor));
  }
  if (action === "revokes") {
    return ok(await service.listRevokes(actor));
  }
  if (action === "sessions") {
    return ok(await service.listSessions(actor));
  }
  if (action === "credentials") {
    return ok(await service.listCredentials(actor));
  }

  throw new UsageError(action ? `unknown identity action '${action}'` : "missing identity action");
}

function needsSessionStore(action: string | undefined, subaction?: string): boolean {
  return action === "login" ||
    action === "logout" ||
    action === "whoami" ||
    action === "sessions" ||
    action === "credentials" ||
    (action === "credential" && (subaction === "issue" || subaction === "revoke"));
}

function openAccess(
  flags: Record<string, string>,
  env: Record<string, string | undefined>,
  sessionsRequired: boolean,
): AccessService {
  const identities = new FileIdentityStore(readIdentitiesPath(flags, env));
  const sessionsPath = flags.sessions ?? env.PORTICO_SESSIONS_PATH;
  if (sessionsRequired && !sessionsPath) {
    throw new UsageError("missing --sessions or PORTICO_SESSIONS_PATH");
  }
  return new AccessService(
    identities,
    sessionsPath ? new FileSessionStore(sessionsPath) : undefined,
  );
}

/**
 * Resolves the calling identity for a CLI command.
 *
 * A login session is the only proof. `--actor-*` used to be accepted on its own
 * by looking the claim up in the roster — but the roster ids are published in
 * the README, so an agent maintainer could type `human:security-auditor` and
 * approve its own public submission. It is now rejected outright, and with no
 * flags at all a command runs as anonymous, exactly like the Portal.
 */
async function resolveFlagsActor(
  flags: Record<string, string>,
  env: Record<string, string | undefined>,
): Promise<Actor> {
  const sessionToken = flags.session ?? env.PORTICO_SESSION;
  const hasActor = Boolean(flags["actor-id"] || flags["actor-kind"] || flags["actor-role"]);
  if (sessionToken) {
    const access = openAccess(flags, env, true);
    const actor = await access.resolveSession(sessionToken);
    if (hasActor) {
      const claimed = readActor(flags);
      if (
        claimed.id !== actor.id || claimed.kind !== actor.kind || claimed.role !== actor.role
      ) {
        throw new UsageError("claimed --actor-* does not match the session identity");
      }
    }
    return actor;
  }
  if (hasActor) {
    throw new UsageError(
      "--actor-* is not proof of an identity and is no longer accepted; run `identity login` and pass --session",
    );
  }
  return { id: "anonymous", kind: "human", role: "anonymous" };
}

/** Like `resolveFlagsActor`, but "no actor given at all" stays distinguishable. */
async function tryResolveActor(
  flags: Record<string, string>,
  env: Record<string, string | undefined>,
): Promise<Actor | null> {
  const sessionToken = flags.session ?? env.PORTICO_SESSION;
  const hasActor = Boolean(flags["actor-id"] || flags["actor-kind"] || flags["actor-role"]);
  if (!sessionToken && !hasActor) return null;
  return await resolveFlagsActor(flags, env);
}

function readSessionToken(
  flags: Record<string, string>,
  env: Record<string, string | undefined>,
): string {
  const token = flags.session ?? env.PORTICO_SESSION;
  if (!token) throw new UsageError("missing --session or PORTICO_SESSION");
  return token;
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
