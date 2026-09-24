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
  standingConclusions,
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
import type { SignInBlocker } from "../access/mod.ts";
import { type GatewayService, listGatewayAudit } from "../gateway/mod.ts";
import { type PageService } from "../ui/mod.ts";
import {
  esc,
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
  renderShell,
  resolvePageTheme,
  summarize,
  type Tone,
  type ViewContext,
} from "./design/mod.ts";
import {
  type CategoryFilter,
  parseCategory,
  parseChannel,
  parseTheme,
  renderMagazinePage,
  renderNotFoundPage,
} from "./html.ts";
import type { ContentCategory } from "../catalog/mod.ts";
import type { ReviewEntry } from "./review-entry.ts";
import { dashboardFrom } from "../catalog/dashboard.ts";
import { audienceReport } from "../catalog/audience.ts";
import { boundarySweep } from "../catalog/boundary.ts";
import {
  type ExchangeGithubCode,
  githubAuthorizeUrl,
  type GithubOauthConfig,
  isAllowedGithubUser,
} from "../review/github.ts";

export interface PortalCfAccess {
  verify(assertion: string): Promise<{ email: string } | null>;
}

export interface PortalGithub {
  config: GithubOauthConfig;
  exchange: ExchangeGithubCode;
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
  /**
   * Optional Portal GitHub OAuth login. Verified, allowlisted GitHub users
   * mint a normal Portico browser session for the roster human their email
   * matches. Absent means off.
   */
  github?: PortalGithub;
}

export async function handlePortalRequest(
  request: Request,
  context: PortalContext,
): Promise<Response> {
  try {
    const url = new URL(request.url);

    // Login routes must be handled before requiring GET-only
    if (url.pathname === "/login") return await handleLogin(request, context);
    if (url.pathname === "/logout") return await handleLogout(request, context);
    if (url.pathname === "/oauth/start") return handleOauthStart(request, context);
    if (url.pathname === "/oauth/callback") return await handleOauthCallback(request, context);

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
      //
      // A cutoff is passed through so the service can refuse it: the check
      // re-reads the files as they stand, so there is no window to honour and
      // the report says so itself (`window: "current"`). Dropping the value
      // here would answer a question the caller did not ask, in a shape the
      // caller could not tell apart from the one it did.
      return jsonOk(
        await sealService(context).report(actor, {
          asOf: url.searchParams.get("asOf") ?? undefined,
        }),
      );
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
      return jsonOk(applyConclusionQuery(records, conclusionQueryFrom(url)));
    }
    if (url.pathname === "/api/conclusions/standings") {
      if (!context.conclusions) return jsonOk([]);
      // Same order as `/api/conclusions`: the role check lives in the service,
      // and a caller who may not read conclusions must not be told that its
      // filter was malformed.
      const records = await context.conclusions.list(actor);
      return jsonOk(standingConclusions(records, conclusionQueryFrom(url)));
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
    // records. Anonymous requests redirect to login with the requested path
    // preserved so they can return after authenticating. API/JSON probes still
    // see no catalog contents — the redirect is HTML-only.
    if (url.pathname === "/internal" || url.pathname.startsWith("/internal/")) {
      if (actor.role === "anonymous") {
        const next = url.pathname + url.search;
        return loginRedirect(next);
      }
      return await internalPage(request, url, actor, context);
    }

    // ── public editorial surface ─────────────────────────────────────────
    if (url.pathname === "/public" || url.pathname.startsWith("/public/")) {
      return await publicPage(request, url, actor, context);
    }

    const theme = parseTheme(url.searchParams.get("theme"));
    const channel = parseChannel(url.searchParams.get("channel"));
    const category = parseCategory(url.searchParams.get("category"));
    const surfacePage = url.pathname.match(/^\/s\/([a-z][a-z0-9-]{1,62})$/);
    const queryId = url.pathname === "/" ? url.searchParams.get("id") : null;
    const selectedId = surfacePage?.[1] ??
      (queryId && /^[a-z][a-z0-9-]{1,62}$/.test(queryId) ? queryId : null);
    if (url.pathname === "/" || surfacePage) {
      const query = parseCatalogQuery({ q: url.searchParams.get("q") });
      if (channel) query.channel = channel;
      const visible = await context.catalog.list(actor);
      const filtered = applyCatalogQuery(visible, query);
      const surfaces = filterByCategory(filtered, category);
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
      if (selectedId) {
        try {
          const selected = await context.catalog.get(actor, selectedId);
          const canonical = canonicalMagazineReadingUrl(url, selected, category);
          const location = magazineSelectionUrl(url, selected, canonical);
          if (surfacePage || canonical) {
            return new Response(null, {
              status: 302,
              headers: { location },
            });
          }
          return html(renderMagazinePage({
            theme,
            channel,
            category,
            q: query.q,
            view: dash,
            selected,
            picks,
            path: url.pathname,
            showInternal: actor.role !== "anonymous",
            pendingPublic,
            reviewEntry: context.reviewEntry,
            signedInId: actor.role !== "anonymous" ? actor.id : undefined,
          }));
        } catch (error) {
          if (error instanceof CatalogError && error.code === ErrorCode.NOT_FOUND) {
            return html(
              renderNotFoundPage(theme, context.reviewEntry, {
                signedInId: actor.role !== "anonymous" ? actor.id : undefined,
                showInternal: actor.role !== "anonymous",
                pendingPublic,
              }),
              404,
            );
          }
          throw error;
        }
      }
      return html(renderMagazinePage({
        theme,
        channel,
        category,
        q: query.q,
        view: dash,
        picks,
        path: "/",
        showInternal: actor.role !== "anonymous",
        pendingPublic,
        reviewEntry: context.reviewEntry,
        signedInId: actor.role !== "anonymous" ? actor.id : undefined,
      }));
    }
    return jsonError(404, ErrorCode.NOT_FOUND, "not found");
  } catch (error) {
    return fail(error);
  }
}

/**
 * `/s/:id` may be opened with a `channel` / `category` / `q` that does not
 * include the selected record. That is a stale navigation state, not a
 * permission miss: rewrite the query so the filtered list contains the record
 * the caller can already see. Unknown or unauthorized ids still 404 before
 * this runs.
 */
/** Old `/s/:id` and a stale filter both land on `/?id=` so Back stays in the magazine. */
function magazineSelectionUrl(url: URL, selected: AgentSurface, canonical: URL | null): string {
  const next = canonical ?? new URL(url);
  next.pathname = "/";
  next.searchParams.set("id", selected.id);
  return `${next.pathname}${next.search}`;
}

function canonicalMagazineReadingUrl(
  url: URL,
  selected: AgentSurface,
  category: CategoryFilter,
): URL | null {
  const channel = parseChannel(url.searchParams.get("channel"));
  const query = parseCatalogQuery({ q: url.searchParams.get("q") });
  if (channel) query.channel = channel;

  const matchesChannel = applyCatalogQuery([selected], query).length > 0;
  const matchesCategory = categoryMatches(selected, category);

  if (matchesChannel && matchesCategory) return null;

  const next = new URL(url);

  if (!matchesCategory && category !== null) {
    const effectiveCategory = selected.category ?? "uncategorized";
    next.searchParams.set("category", effectiveCategory);
  }

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
 * Filter surfaces by content category. When category is null, all surfaces
 * pass. Otherwise, a surface matches if its effective category (defaulting
 * to "uncategorized" when undefined) equals the filter.
 */
function filterByCategory(
  surfaces: AgentSurface[],
  category: CategoryFilter,
): AgentSurface[] {
  if (category === null) return surfaces;
  return surfaces.filter((surface) => categoryMatches(surface, category));
}

/**
 * Check if a surface matches a category filter. A null filter matches all.
 * Effective category = surface.category ?? "uncategorized".
 */
function categoryMatches(surface: AgentSurface, category: CategoryFilter): boolean {
  if (category === null) return true;
  const effective: ContentCategory = surface.category ?? "uncategorized";
  return effective === category;
}

/**
 * Portal callers prove who they are with a session, or they are anonymous.
 * There is deliberately no `X-Portico-Actor-*` path: a header is not proof of
 * an identity, and the roster ids are published in the README.
 *
 * Session tokens can come from:
 * 1. `Authorization: Bearer` or `X-Portico-Session` headers (API style)
 * 2. `portico_session` cookie (browser style, set by /login)
 *
 * A verified Cloudflare Access JWT is a Portal-only fallback: it never writes
 * a session, never outranks a presented Portico session, and the plaintext
 * `Cf-Access-Authenticated-User-Email` header is not proof.
 */
async function resolveActor(request: Request, context: PortalContext): Promise<Actor> {
  const headerToken = readSessionToken(request);
  if (headerToken) {
    // API-style session tokens (Authorization header or X-Portico-Session)
    // must throw on invalid/revoked sessions — the caller explicitly presented
    // proof and it's wrong, so FORBIDDEN is the right answer.
    return await context.access.resolveSession(headerToken);
  }
  const cookieToken = readSessionCookie(request);
  if (cookieToken) {
    // Cookie-based sessions (browser flow) fall back to anonymous when
    // invalid/expired — a stale cookie from a previous session should redirect
    // to login, not 403 an unsuspecting browser.
    try {
      return await context.access.resolveSession(cookieToken);
    } catch {
      // Invalid or expired cookie session: fall through to anonymous or CF Access.
    }
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
  return { id: "anonymous", kind: "human", role: "anonymous" };
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
    asOf: url.searchParams.get("asOf"),
  });
}

/**
 * The conclusions filter, read the way the trail filter is: the same parameter
 * names in JSON, in the internal form and on the CLI. A cutoff given to one is
 * honoured by the other, so one page cannot show a trail as of March beside a
 * standing verdict as of today.
 */
function conclusionQueryFrom(url: URL) {
  return parseConclusionQuery({
    subject: url.searchParams.get("subject") ?? undefined,
    scope: url.searchParams.get("scope") ?? undefined,
    verdict: url.searchParams.get("verdict") ?? undefined,
    asOf: url.searchParams.get("asOf") ?? undefined,
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
    const stateRaw = url.searchParams.get("state");
    const state = stateRaw === "draft" || stateRaw === "internal" ||
        stateRaw === "pending_public" || stateRaw === "approved_public" ||
        stateRaw === "rejected"
      ? stateRaw
      : undefined;
    const idRaw = url.searchParams.get("id");
    const selectedId = idRaw && /^[a-z][a-z0-9-]{1,62}$/.test(idRaw) ? idRaw : undefined;
    return html(renderContentView({
      ctx: base,
      surfaces,
      recentEvents: events,
      selectedId,
      state,
    }));
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
    // This page tells the auditor that the trail cannot be rewritten, so it has
    // to show the evidence for that claim. The verdict comes from the same
    // service CLI `audit verify` and MCP `portico_audit_verify` read, and it is
    // rendered beside the events it covers rather than only on demand.
    const integrity = await sealService(context).report(actor);
    // The audit page is where the auditor reads the trail, so it is also where
    // the derived answer belongs: what the audit currently finds, per subject.
    // Only the cutoff crosses over from the trail filter — the panel answers
    // "what stands" for the window the trail is read through, while kind,
    // action and text narrow the trail itself and must not silently hide a
    // subject that stands flagged.
    const conclusions = standingConclusions(
      context.conclusions ? await context.conclusions.list(actor) : [],
      query.asOf ? { asOf: query.asOf } : {},
    );
    return html(
      renderAuditView({ ctx: base, events, query, integrity, standings: conclusions }),
    );
  }

  const surfaceMatch = url.pathname.match(/^\/internal\/s\/([a-z][a-z0-9-]{1,62})$/);
  if (surfaceMatch) {
    return new Response(null, {
      status: 303,
      headers: { location: `/internal?id=${encodeURIComponent(surfaceMatch[1])}` },
    });
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
    "content-security-policy":
      "default-src 'none'; style-src 'unsafe-inline'; img-src data:; media-src https: http:",
  };
}

function loginSecurityHeaders(contentType: string): HeadersInit {
  return {
    "content-type": contentType,
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
    "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'",
  };
}

/**
 * Why this process cannot sign a browser session in, or `undefined` when it can.
 *
 * `POST /login` writes one row to the session store, so the answer is a property
 * of the running process rather than of the deployment document: a Portal
 * started without that scoped write — the read-only container in
 * `deploy/run-portal.sh`, or any hand-started process that forgot it — answered
 * `403 登录失败` and left the reader guessing between "wrong credential" and
 * "this deployment cannot do this at all". The AccessService answers for its own
 * store, and the page says which one it is.
 */
function signInBlockerText(blocker: SignInBlocker): string {
  if (blocker.code === "sessions_not_configured") {
    return "这个部署没有给 Portal 配置会话存储（PORTICO_SESSIONS_PATH）。";
  }
  return `这个部署的 Portal 进程没有 ${blocker.path} 的写权限（它只写这一个文件：目录、名册与审计都不写）。`;
}

function loginRedirect(next?: string): Response {
  const target = next && isSafeNextPath(next)
    ? `/login?next=${encodeURIComponent(next)}`
    : "/login";
  return new Response(null, { status: 303, headers: { location: target } });
}

function isSafeNextPath(path: string): boolean {
  if (!path.startsWith("/")) return false;
  if (path.startsWith("//")) return false;
  try {
    const url = new URL(path, "http://localhost");
    return url.pathname === path.split("?")[0];
  } catch {
    return false;
  }
}

async function handleLogin(request: Request, context: PortalContext): Promise<Response> {
  const url = new URL(request.url);
  const next = url.searchParams.get("next");
  const safeNext = next && isSafeNextPath(next) ? next : null;

  if (request.method === "GET") {
    const actor = await resolveActor(request, context);
    if (actor.role !== "anonymous") {
      return postLoginRedirect(actor, safeNext);
    }
    return new Response(
      renderLoginPage(request, context.github !== undefined, safeNext, undefined, {
        blocked: await context.access.signInBlocked(),
      }),
      { status: 200, headers: loginSecurityHeaders("text/html; charset=utf-8") },
    );
  }

  if (request.method !== "POST") {
    return jsonError(405, ErrorCode.USAGE, "method not allowed");
  }

  const contentType = request.headers.get("content-type") ?? "";
  const body = contentType.includes("application/json")
    ? await request.json() as { id?: unknown; token?: unknown }
    : Object.fromEntries((await request.formData()).entries());

  if (typeof body.id !== "string" || typeof body.token !== "string") {
    return new Response(
      renderLoginPage(request, context.github !== undefined, safeNext, "身份和凭证都是必填项", {
        blocked: await context.access.signInBlocked(),
      }),
      { status: 400, headers: loginSecurityHeaders("text/html; charset=utf-8") },
    );
  }

  // Refused before the attempt, so a deployment that cannot mint a session says
  // so instead of reporting a permission denial as a bad credential.
  const blocked = await context.access.signInBlocked();
  if (blocked) {
    return new Response(
      renderLoginPage(request, context.github !== undefined, safeNext, undefined, { blocked }),
      { status: 403, headers: loginSecurityHeaders("text/html; charset=utf-8") },
    );
  }

  try {
    const session = await context.access.login({ id: body.id, token: body.token });
    if (session.actor.kind !== "human") {
      return new Response(
        renderLoginPage(request, context.github !== undefined, safeNext, "浏览器登录仅限人类身份"),
        { status: 403, headers: loginSecurityHeaders("text/html; charset=utf-8") },
      );
    }
    return postLoginResponse(session.actor, session.token, safeNext);
  } catch (error) {
    const message = error instanceof CatalogError ? "身份或凭证无效" : "登录失败";
    return new Response(
      renderLoginPage(request, context.github !== undefined, safeNext, message),
      { status: 403, headers: loginSecurityHeaders("text/html; charset=utf-8") },
    );
  }
}

async function handleLogout(request: Request, context: PortalContext): Promise<Response> {
  if (request.method !== "POST") {
    return jsonError(405, ErrorCode.USAGE, "method not allowed");
  }

  const token = readSessionCookie(request);
  if (token) {
    try {
      await context.access.logout(token);
    } catch {
      // Ignore logout failures; the cookie is cleared regardless.
    }
  }

  const headers = new Headers({ location: "/" });
  headers.append(
    "set-cookie",
    "portico_session=; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=0",
  );
  return new Response(null, { status: 303, headers });
}

async function handleOauthStart(_request: Request, context: PortalContext): Promise<Response> {
  if (!context.github) {
    return jsonError(501, ErrorCode.INVALID_STATE, "github login is not configured");
  }
  // The callback mints a session, so a deployment that cannot write the session
  // store must refuse before sending the reader through GitHub and back.
  const blocked = await context.access.signInBlocked();
  if (blocked) return jsonError(403, ErrorCode.INVALID_STATE, signInBlockerText(blocked));
  const state = randomState();
  return new Response(null, {
    status: 303,
    headers: {
      location: githubAuthorizeUrl(context.github.config, state),
      "set-cookie":
        `portico_oauth_state=${state}; Path=/oauth/callback; Secure; HttpOnly; SameSite=Lax; Max-Age=600`,
    },
  });
}

async function handleOauthCallback(request: Request, context: PortalContext): Promise<Response> {
  if (!context.github) {
    return jsonError(501, ErrorCode.INVALID_STATE, "github login is not configured");
  }

  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const expected = readCookie(request, "portico_oauth_state");

  const fail = (status: number, reason: string, log: string): Response => {
    console.error(`[portal/oauth] ${log}`);
    return new Response(
      renderLoginPage(request, true, null, reason),
      { status, headers: loginSecurityHeaders("text/html; charset=utf-8") },
    );
  };

  if (!code || !state || !expected || state !== expected) {
    return fail(400, "GitHub 回调校验失败，请重新点击登录。", "state mismatch or missing code");
  }

  let user;
  try {
    user = await context.github.exchange(context.github.config, code);
  } catch {
    return fail(502, "GitHub 换 token 失败，请重试。", "github exchange failed");
  }

  if (!isAllowedGithubUser(user, context.github.config.allowlist)) {
    console.error(`[portal/oauth] allowlist deny login=${user.login}`);
    return fail(403, `GitHub 账号 ${user.login} 不在 allowlist 中。`, "allowlist deny");
  }

  const emails = [user.email, ...user.emails].filter((email): email is string => !!email);
  const sessionErrors: string[] = [];
  for (const email of emails) {
    try {
      const session = await context.access.createBrowserSession(email);
      return oauthSuccessResponse(session.actor, session.token);
    } catch (error) {
      sessionErrors.push(error instanceof Error ? error.message : String(error));
    }
  }

  console.error(
    `[portal/oauth] roster miss login=${user.login} emails=${emails.join(",")}` +
      (sessionErrors.length > 0 ? ` errors=[${sessionErrors.join("; ")}]` : ""),
  );
  return fail(
    403,
    `GitHub 登录成功，但名册里没有 ${emails[0] ?? "你的邮箱"}，请联系管理员绑定。`,
    "roster miss",
  );
}

function postLoginRedirect(actor: Actor, next: string | null): Response {
  const target = postLoginTarget(actor, next);
  return new Response(null, { status: 303, headers: { location: target } });
}

function postLoginResponse(actor: Actor, token: string, next: string | null): Response {
  const target = postLoginTarget(actor, next);
  const headers = new Headers({ location: target });
  headers.append(
    "set-cookie",
    `portico_session=${encodeURIComponent(token)}; Path=/; Secure; HttpOnly; SameSite=Lax`,
  );
  return new Response(null, { status: 303, headers });
}

function oauthSuccessResponse(actor: Actor, token: string): Response {
  const target = postLoginTarget(actor, null);
  const headers = new Headers({ location: target });
  headers.append(
    "set-cookie",
    `portico_session=${encodeURIComponent(token)}; Path=/; Secure; HttpOnly; SameSite=Lax`,
  );
  headers.append("set-cookie", "portico_oauth_state=; Path=/oauth/callback; Max-Age=0");
  return new Response(null, { status: 303, headers });
}

function postLoginTarget(actor: Actor, next: string | null): string {
  if (next && isSafeNextPath(next)) return next;
  if (actor.role === "reader" || actor.role === "maintainer" || actor.role === "auditor") {
    return "/internal";
  }
  return "/";
}

function readCookie(request: Request, name: string): string | null {
  const cookies = request.headers.get("cookie") ?? "";
  const match = new RegExp(`(?:^|;\\s*)${name}=([^;]+)`).exec(cookies);
  return match ? decodeURIComponent(match[1]) : null;
}

function readSessionCookie(request: Request): string | null {
  return readCookie(request, "portico_session");
}

function randomState(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

const LOGIN_CSS = `
.login-wrap{min-height:72vh;display:flex;align-items:center;justify-content:center;padding:32px 16px}
.login-card{max-width:400px;width:100%;padding:28px}
.login-card h1{font-size:1.25rem;margin:6px 0 4px}
.login-card .tk-meta{margin:0}
.login-github{display:block;text-align:center;text-decoration:none;font-weight:600;font-size:0.9rem;color:#f0f3f6;background:#24292f;border:1px solid #444c56;border-radius:8px;padding:10px;margin:16px 0 4px}
.login-github:hover{background:#2f363d}
.login-div{display:flex;align-items:center;gap:10px;color:var(--tk-muted);font-size:0.78rem;margin:18px 0 6px}
.login-div::before,.login-div::after{content:"";flex:1;border-top:1px solid var(--tk-border, #2a2f36)}
.login-field{margin:12px 0}
.login-field label{display:block;font-size:0.8rem;color:var(--tk-muted);margin-bottom:6px}
.login-field input{display:block;width:100%;box-sizing:border-box;font-size:0.9rem;color:var(--tk-ink);background:var(--tk-sunken);border:1px solid var(--tk-border, #2a2f36);border-radius:8px;padding:9px 10px}
.login-card .tk-btn{width:100%;margin-top:14px;padding:10px}
`;

function renderLoginPage(
  request: Request,
  githubEnabled: boolean,
  next: string | null,
  error?: string,
  options: { blocked?: SignInBlocker } = {},
): string {
  const alert = error ? `<p class="tk-note" role="alert">${esc(error)}</p>` : "";
  const nextField = next ? `<input type="hidden" name="next" value="${esc(next)}">` : "";
  const formAction = next ? `/login?next=${encodeURIComponent(next)}` : "/login";
  const unavailable = options.blocked !== undefined;

  // A login form that cannot succeed is a lie about the deployment, so it is
  // not rendered: the reason and the entrances that do work take its place.
  const signIn = unavailable
    ? `<div class="tk-note" role="alert" data-login="unavailable">
        <p><strong>这个部署无法在浏览器里登录。</strong>${
      esc(signInBlockerText(options.blocked!))
    }</p>
        <p>可选：用 CLI 换取会话（<code>deno task cli -- identity login …</code>）；把请求发给提供
        <code>/review</code> 的入口；或让运维给 Portal 进程补上会话存储的写权限后重启。</p>
      </div>`
    : `${
      githubEnabled
        ? `<a class="login-github" href="/oauth/start">使用 GitHub 登录</a><div class="login-div"><span>或一次性凭证</span></div>`
        : ""
    }
      <form method="post" action="${esc(formAction)}">
        ${nextField}
        <div class="login-field"><label for="login-id">身份</label><input id="login-id" name="id" autocomplete="username" required></div>
        <div class="login-field"><label for="login-token">一次性凭证</label><input id="login-token" name="token" type="password" autocomplete="current-password" required></div>
        <button class="tk-btn" type="submit">登录</button>
      </form>
      <p class="tk-note" style="margin-top:16px">登录后可访问内部工作台。仅 allowlisted 账号可通过 GitHub 登录；能看到什么由名册决定。</p>`;

  return renderShell({
    title: "登录",
    tone: "internal",
    theme: resolvePageTheme("internal", null, prefersDark(request.headers)),
    path: "/login",
    head: `<style>${LOGIN_CSS}</style>`,
    body: `  <main class="login-wrap">
    <div class="tk-panel login-card"${unavailable ? ' data-login="unavailable"' : ""}>
      <p class="tk-meta">PORTICO · 门户登录</p>
      <h1>登录</h1>
      ${alert}
      ${signIn}
    </div>
  </main>`,
  });
}
