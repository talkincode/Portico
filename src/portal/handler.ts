import { AccessService } from "../access/mod.ts";
import { readSessionToken } from "../access/session-header.ts";
import {
  AnchorService,
  type AnchorStore,
  applyAuditQuery,
  applyConclusionQuery,
  AuditService,
  type ConclusionService,
  MemoryAnchorStore,
  parseAuditQuery,
  parseConclusionQuery,
  SealService,
} from "../audit/mod.ts";
import {
  type Actor,
  type AgentSurface,
  applyCatalogQuery,
  CatalogError,
  CatalogService,
  type Channel,
  ErrorCode,
  parseCatalogQuery,
} from "../catalog/mod.ts";
import { type GatewayService, listGatewayAudit } from "../gateway/mod.ts";
import { type PageService } from "../ui/mod.ts";
import {
  prefersDark,
  type PublicContext,
  renderApprovalsView,
  renderAuditView,
  renderCatalogView,
  renderContentView,
  renderPendingView,
  renderPublicArticle,
  renderPublicIndex,
  renderPublicTopic,
  renderSurfaceView,
  resolvePageTheme,
  summarize,
  type Tone,
  type ViewContext,
} from "./design/mod.ts";
import { parseChannel, parseTheme, renderMagazinePage, renderNotFoundPage } from "./html.ts";
import type { ReviewEntry } from "./review-entry.ts";
import { dashboardFrom } from "../catalog/dashboard.ts";
import { audienceReport } from "../catalog/audience.ts";
import { boundarySweep } from "../catalog/boundary.ts";

export interface PortalCfAccess {
  verify(assertion: string): Promise<{ email: string } | null>;
}

export interface PortalContext {
  catalog: CatalogService;
  access: AccessService;
  gateway?: GatewayService;
  pages?: PageService;
  /**
   * Optional auditor security conclusions. The Portal reads them; it never
   * writes one — the process runs without `--allow-write`.
   */
  conclusions?: ConclusionService;
  /**
   * Optional seal checkpoints. Read-only here as well: the Portal compares the
   * pillars against them and reports, but only an auditor with CLI access can
   * take a new one.
   */
  sealAnchors?: AnchorStore;
  /**
   * Optional Portal-only Cloudflare Access mapping. Absent means the feature
   * is off: `Cf-Access-Jwt-Assertion` is ignored. CLI / Gateway / MCP must
   * not grow an equivalent field.
   */
  cfAccess?: PortalCfAccess;
  /**
   * The Review entrance this deployment serves, from `PORTICO_REVIEW_ORIGIN`.
   * Absent means the same-origin default; `{ kind: "none" }` means this
   * deployment ships no Review behind the chrome, so no page advertises one.
   */
  reviewEntry?: ReviewEntry;
}

export async function handlePortalRequest(
  request: Request,
  context: PortalContext,
): Promise<Response> {
  try {
    const url = new URL(request.url);
    const actor = await resolveActor(request, context);
    if (request.method !== "GET") {
      return jsonError(405, ErrorCode.USAGE, "method not allowed");
    }
    if (url.pathname === "/api/catalog") {
      const query = parseCatalogQuery({
        q: url.searchParams.get("q"),
        channel: url.searchParams.get("channel"),
        state: url.searchParams.get("state"),
      });
      return jsonOk(applyCatalogQuery(await context.catalog.list(actor), query));
    }
    const catalogItem = url.pathname.match(/^\/api\/catalog\/([a-z][a-z0-9-]{1,62})$/);
    if (catalogItem) {
      return jsonOk(await context.catalog.get(actor, catalogItem[1]));
    }
    if (url.pathname === "/api/mcp") {
      return jsonOk(await context.catalog.listMcp(actor));
    }
    const mcpItem = url.pathname.match(/^\/api\/mcp\/([a-z][a-z0-9-]{1,62})$/);
    if (mcpItem) {
      return jsonOk(await context.catalog.describeMcp(actor, mcpItem[1]));
    }
    if (url.pathname === "/api/web") {
      return jsonOk(await context.catalog.listWeb(actor));
    }
    const webItem = url.pathname.match(/^\/api\/web\/([a-z][a-z0-9-]{1,62})$/);
    if (webItem) {
      return jsonOk(await context.catalog.describeWeb(actor, webItem[1]));
    }
    if (url.pathname === "/api/cli") {
      return jsonOk(await context.catalog.listCli(actor));
    }
    const cliItem = url.pathname.match(/^\/api\/cli\/([a-z][a-z0-9-]{1,62})$/);
    if (cliItem) {
      return jsonOk(await context.catalog.describeCli(actor, cliItem[1]));
    }
    if (url.pathname === "/api/audit") {
      const events = await auditService(context).list(actor);
      return jsonOk(applyAuditQuery(events, auditQueryFrom(url)));
    }
    if (url.pathname === "/api/audit-verify") {
      // Read-only, like the rest of the Portal: it re-derives the seal from the
      // files and reports. A non-auditor gets FORBIDDEN from the service.
      return jsonOk(await sealService(context).report(actor));
    }
    if (url.pathname === "/api/seal-anchors") {
      // The checkpoints themselves, newest last: who pinned which tips, when.
      // Same gate as the seal report — the service refuses a non-auditor.
      return jsonOk(await anchorService(context).list(actor));
    }
    if (url.pathname === "/api/dashboard") {
      const surfaces = await context.catalog.list(actor);
      return jsonOk(dashboardFrom(surfaces));
    }
    const audience = url.pathname.match(/^\/api\/audience\/([a-z][a-z0-9-]{1,62})$/);
    if (audience) {
      // One surface at the public trust boundary: what it claims, what the read
      // path serves, and who that reaches. The service refuses anyone who is
      // not an auditor or maintainer, and hides a draft from both.
      return jsonOk(
        await audienceReport(context.catalog, context.access, actor, audience[1]),
      );
    }
    if (url.pathname === "/api/boundary") {
      // The whole boundary at once: what is exposed right now and every record
      // that disagrees with its trail. Same gate as the per-record report.
      return jsonOk(await boundarySweep(context.catalog, context.access, actor));
    }
    if (url.pathname === "/api/identities") {
      return jsonOk(await context.access.list(actor));
    }
    if (url.pathname === "/api/grants") {
      return jsonOk(await context.access.listGrants(actor));
    }
    if (url.pathname === "/api/revokes") {
      return jsonOk(await context.access.listRevokes(actor));
    }
    if (url.pathname === "/api/sessions") {
      return jsonOk(await context.access.listSessions(actor));
    }
    if (url.pathname === "/api/credentials") {
      return jsonOk(await context.access.listCredentials(actor));
    }
    if (url.pathname === "/api/credential-revokes") {
      return jsonOk(await context.access.listCredentialRevokes(actor));
    }
    if (url.pathname === "/api/gateway-audit") {
      return jsonOk(await listGatewayAudit(context.gateway, actor));
    }
    if (url.pathname === "/api/conclusions") {
      if (!context.conclusions) return jsonOk([]);
      // List first: the role check lives in `ConclusionService.list`, and a
      // caller who may not read conclusions must not be told that its filter
      // was malformed. `/api/audit` reads the same way.
      const records = await context.conclusions.list(actor);
      const query = parseConclusionQuery({
        subject: url.searchParams.get("subject") ?? undefined,
        scope: url.searchParams.get("scope") ?? undefined,
        verdict: url.searchParams.get("verdict") ?? undefined,
      });
      return jsonOk(applyConclusionQuery(records, query));
    }
    if (url.pathname === "/api/whoami") {
      return jsonOk(await context.access.whoami(actor));
    }
    if (url.pathname === "/api/approvals") {
      return jsonOk(await context.catalog.listApprovals(actor));
    }
    if (url.pathname === "/api/page") {
      if (!context.pages) return jsonOk({ components: [] });
      return jsonOk(await context.pages.get(actor));
    }

    // ── internal console ─────────────────────────────────────────────────
    // Everything below is served only to identities that already see internal
    // records. Anonymous requests get a 404, not a 403: an unauthenticated
    // caller learns nothing about which routes exist.
    if (url.pathname === "/internal" || url.pathname.startsWith("/internal/")) {
      if (actor.role === "anonymous") {
        return htmlNotFound(request, context.reviewEntry);
      }
      return await internalPage(request, url, actor, context);
    }

    // ── public editorial surface ─────────────────────────────────────────
    if (url.pathname === "/public" || url.pathname.startsWith("/public/")) {
      return await publicPage(request, url, actor, context);
    }

    const theme = parseTheme(url.searchParams.get("theme"));
    const channel = parseChannel(url.searchParams.get("channel"));
    const surfacePage = url.pathname.match(/^\/s\/([a-z][a-z0-9-]{1,62})$/);
    if (url.pathname === "/" || surfacePage) {
      const query = parseCatalogQuery({ q: url.searchParams.get("q") });
      if (channel) query.channel = channel;
      const visible = await context.catalog.list(actor);
      const surfaces = applyCatalogQuery(visible, query);
      const dash = dashboardFrom(surfaces);
      const pendingPublic = actor.role === "anonymous"
        ? undefined
        : visible.filter((surface) => surface.governanceState === "pending_public").length;
      const page = context.pages ? await context.pages.get(actor) : undefined;
      const picks = (page?.components ?? []).flatMap((item) => {
        if (item.kind !== "catalog_card") return [];
        return [{
          id: item.id,
          name: item.name,
          description: item.description,
          governanceState: item.governanceState,
          channels: [...item.channels],
          version: item.version,
        }];
      });
      if (surfacePage) {
        try {
          const selected = await context.catalog.get(actor, surfacePage[1]);
          const canonical = canonicalMagazineReadingUrl(url, selected);
          if (canonical) {
            return new Response(null, {
              status: 302,
              headers: { location: `${canonical.pathname}${canonical.search}` },
            });
          }
          return html(renderMagazinePage({
            theme,
            channel,
            q: query.q,
            view: dash,
            selected,
            picks,
            path: url.pathname,
            showInternal: actor.role !== "anonymous",
            pendingPublic,
            reviewEntry: context.reviewEntry,
          }));
        } catch (error) {
          if (error instanceof CatalogError && error.code === ErrorCode.NOT_FOUND) {
            return html(renderNotFoundPage(theme, context.reviewEntry), 404);
          }
          throw error;
        }
      }
      return html(renderMagazinePage({
        theme,
        channel,
        q: query.q,
        view: dash,
        picks,
        path: "/",
        showInternal: actor.role !== "anonymous",
        pendingPublic,
        reviewEntry: context.reviewEntry,
      }));
    }
    return jsonError(404, ErrorCode.NOT_FOUND, "not found");
  } catch (error) {
    return fail(error);
  }
}

/**
 * `/s/:id` may be opened with a `channel` / `q` that does not include the
 * selected record. That is a stale navigation state, not a permission miss:
 * rewrite the query so the filtered list contains the record the caller can
 * already see. Unknown or unauthorized ids still 404 before this runs.
 */
function canonicalMagazineReadingUrl(url: URL, selected: AgentSurface): URL | null {
  const channel = parseChannel(url.searchParams.get("channel"));
  const query = parseCatalogQuery({ q: url.searchParams.get("q") });
  if (channel) query.channel = channel;
  if (applyCatalogQuery([selected], query).length > 0) return null;

  const next = new URL(url);
  if (query.channel && !selected.channels.includes(query.channel)) {
    const own = selected.channels[0];
    if (own) next.searchParams.set("channel", own);
    else next.searchParams.delete("channel");
  }
  const remainingQ = parseCatalogQuery({ q: next.searchParams.get("q") }).q;
  if (remainingQ && applyCatalogQuery([selected], { q: remainingQ }).length === 0) {
    next.searchParams.delete("q");
  }
  if (next.search === url.search) return null;
  return next;
}

/**
 * Portal callers prove who they are with a session, or they are anonymous.
 * There is deliberately no `X-Portico-Actor-*` path: a header is not proof of
 * an identity, and the roster ids are published in the README.
 *
 * A verified Cloudflare Access JWT is a Portal-only fallback: it never writes
 * a session, never outranks a presented Portico session, and the plaintext
 * `Cf-Access-Authenticated-User-Email` header is not proof.
 */
async function resolveActor(request: Request, context: PortalContext): Promise<Actor> {
  const sessionToken = readSessionToken(request);
  if (sessionToken) {
    return await context.access.resolveRequestActor({ sessionToken });
  }
  if (context.cfAccess) {
    const assertion = request.headers.get("cf-access-jwt-assertion");
    if (assertion) {
      try {
        const verified = await context.cfAccess.verify(assertion);
        if (verified?.email) {
          const mapped = await context.access.lookupHumanByEmail(verified.email);
          if (mapped) return mapped;
        }
      } catch {
        // Fail closed to anonymous. A thrown verifier must not 500-open /internal.
      }
    }
  }
  return await context.access.resolveRequestActor({ sessionToken: null });
}

function auditService(context: PortalContext): AuditService {
  return new AuditService(context.catalog, context.access, context.gateway);
}

function sealService(context: PortalContext): SealService {
  return new SealService(
    context.catalog,
    context.access,
    context.gateway,
    context.conclusions,
    context.sealAnchors,
  );
}

function anchorService(context: PortalContext): AnchorService {
  // With no configured file this entrance has no checkpoints to show, which an
  // empty in-memory store says exactly. Reporting `[]` is honest here; taking
  // a checkpoint is a CLI action and stays unreachable from the Portal.
  return new AnchorService(context.sealAnchors ?? new MemoryAnchorStore(), sealService(context));
}

function auditQueryFrom(url: URL) {
  return parseAuditQuery({
    q: url.searchParams.get("q"),
    kind: url.searchParams.get("kind"),
    action: url.searchParams.get("action"),
    subject: url.searchParams.get("subject"),
  });
}

/** An auditor-only view of the trail; every other role gets a refusal. */
async function auditTrail(actor: Actor, context: PortalContext) {
  if (!isAuditor(actor)) return [];
  return await auditService(context).list(actor);
}

function isAuditor(actor: Actor): boolean {
  return actor.kind === "human" && actor.role === "auditor";
}

function pageTheme(request: Request, url: URL, tone: Tone) {
  return resolvePageTheme(tone, url.searchParams.get("theme"), prefersDark(request.headers));
}

/* ── internal console ─────────────────────────────────────────────────── */

async function internalPage(
  request: Request,
  url: URL,
  actor: Actor,
  context: PortalContext,
): Promise<Response> {
  const theme = pageTheme(request, url, "internal");
  const path = url.pathname + url.search;
  const surfaces = await context.catalog.list(actor);
  const base: ViewContext = {
    actor,
    path,
    theme,
    counts: summarize(surfaces),
    reviewEntry: context.reviewEntry,
  };

  if (url.pathname === "/internal") {
    const events = await auditTrail(actor, context);
    return html(renderContentView({ ctx: base, surfaces, recentEvents: events }));
  }

  if (url.pathname === "/internal/c") {
    const state = url.searchParams.get("state") ?? undefined;
    const channel = url.searchParams.get("channel") ?? undefined;
    return html(
      renderCatalogView({
        ctx: base,
        surfaces,
        filter: { state: state ?? undefined, channel: channel ?? undefined },
      }),
    );
  }

  if (url.pathname === "/internal/approvals") {
    const records = await context.catalog.listApprovals(actor);
    return html(renderApprovalsView({ ctx: base, records }));
  }

  if (url.pathname === "/internal/pending") {
    const channel = parseChannel(url.searchParams.get("channel"));
    const pending = applyCatalogQuery(surfaces, {
      governanceState: "pending_public",
    });
    return html(renderPendingView({ ctx: base, surfaces: pending, channel }));
  }

  if (url.pathname === "/internal/audit") {
    // The trail is a privileged surface, not an empty screen for everyone
    // else: a non-auditor must not learn that the route exists at all.
    if (!isAuditor(actor)) return htmlNotFound(request, context.reviewEntry);
    const query = auditQueryFrom(url);
    const events = applyAuditQuery(await auditTrail(actor, context), query);
    return html(renderAuditView({ ctx: base, events, query }));
  }

  const surfaceMatch = url.pathname.match(/^\/internal\/s\/([a-z][a-z0-9-]{1,62})$/);
  if (surfaceMatch) {
    try {
      const surface = await context.catalog.get(actor, surfaceMatch[1]);
      const events = await auditTrail(actor, context);
      return html(renderSurfaceView({ ctx: base, surface, events }));
    } catch (error) {
      if (error instanceof CatalogError && error.code === ErrorCode.NOT_FOUND) {
        return htmlNotFound(request, context.reviewEntry);
      }
      throw error;
    }
  }

  return htmlNotFound(request, context.reviewEntry);
}

/* ── public editorial surface ─────────────────────────────────────────── */

async function publicPage(
  request: Request,
  url: URL,
  actor: Actor,
  context: PortalContext,
): Promise<Response> {
  const theme = pageTheme(request, url, "public");
  const path = url.pathname + url.search;
  const ctx: PublicContext = { actor, path, theme, reviewEntry: context.reviewEntry };
  // The editorial surface renders only what crossed the approval boundary, even
  // for an internal session: `publicOnly` is applied inside the views.
  const surfaces = await context.catalog.list(actor);

  if (url.pathname === "/public") {
    return html(renderPublicIndex({ ctx, surfaces }));
  }

  const topicMatch = url.pathname.match(/^\/public\/t\/(cli|mcp|web)$/);
  if (topicMatch) {
    return html(
      renderPublicTopic({ ctx, surfaces, channel: topicMatch[1] as Channel }),
    );
  }

  const storyMatch = url.pathname.match(/^\/public\/s\/([a-z][a-z0-9-]{1,62})$/);
  if (storyMatch) {
    try {
      const surface = await context.catalog.get(actor, storyMatch[1]);
      const page = renderPublicArticle({ ctx, surface, others: surfaces });
      // A record that never crossed the boundary has no published page at all.
      if (page === null) return htmlNotFound(request, context.reviewEntry);
      return html(page);
    } catch (error) {
      if (error instanceof CatalogError && error.code === ErrorCode.NOT_FOUND) {
        return htmlNotFound(request, context.reviewEntry);
      }
      throw error;
    }
  }

  return htmlNotFound(request, context.reviewEntry);
}

function jsonOk(data: unknown): Response {
  return json(200, { ok: true, data });
}

function jsonError(status: number, code: string, message: string): Response {
  return json(status, { ok: false, error: { code, message } });
}

function fail(error: unknown): Response {
  if (error instanceof CatalogError) {
    const status = statusFor(error.code);
    return jsonError(status, error.code, error.message);
  }
  const message = error instanceof Error ? error.message : String(error);
  return jsonError(500, "INTERNAL", message);
}

function statusFor(code: string): number {
  if (code === ErrorCode.NOT_FOUND) return 404;
  if (code === ErrorCode.FORBIDDEN || code === ErrorCode.SELF_APPROVAL) return 403;
  if (code === ErrorCode.USAGE) return 405;
  return 400;
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: securityHeaders("application/json; charset=utf-8"),
  });
}

function html(body: string, status = 200): Response {
  return new Response(body, {
    status,
    headers: securityHeaders("text/html; charset=utf-8"),
  });
}

/**
 * Human-facing pages 404 as HTML. A JSON envelope would tell a browser this is
 * an API, and it would disagree with the magazine shell's missing `/s/:id`
 * page. API routes still use `jsonError`.
 */
function htmlNotFound(request: Request, reviewEntry?: ReviewEntry): Response {
  const url = new URL(request.url);
  return html(
    renderNotFoundPage(parseTheme(url.searchParams.get("theme")), reviewEntry),
    404,
  );
}

function securityHeaders(contentType: string): HeadersInit {
  return {
    "content-type": contentType,
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
    "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; img-src data:",
  };
}
