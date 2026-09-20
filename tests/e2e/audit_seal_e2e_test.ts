import { assert, assertEquals } from "../assert.ts";
import { MCP_PERMS, PORTAL_PERMS } from "../../src/perms.ts";
import { actor, bootstrapRoster, ROOT, runCli, sampleRecord, sessionFor } from "./harness.ts";
import { bootEntrypoint } from "./process.ts";

/**
 * The seal is one contract on three entrances: CLI `audit verify`, Portal
 * `GET /api/audit-verify` and MCP `portico_audit_verify` must re-derive the
 * same chains, agree on the same tips, and name the same record when the
 * trail has been edited behind the store's back.
 *
 * Two properties matter beyond the happy path. Verification must be read-only
 * — asking whether the trail is intact must never touch it — and it must be
 * auditor-only, because a break report names records.
 */

const PORTAL = `${ROOT}src/portal/main.ts`;
const MCP = `${ROOT}src/mcp/main.ts`;

interface Envelope<T> {
  ok: boolean;
  data?: T;
  error?: { code: string; message: string };
}

interface SealBreak {
  seq: number;
  kind: string;
  id: string;
  reason: string;
}

interface SealVerdict {
  pillar: string;
  ok: boolean;
  sealed: number;
  unsealed: string[];
  break?: SealBreak;
  tip: string;
}

interface SealReport {
  ok: boolean;
  unsealed: number;
  pillars: SealVerdict[];
}

interface JsonRpcBody {
  result?: { content?: Array<{ text: string }>; isError?: boolean };
}

function envelope<T>(body: JsonRpcBody): Envelope<T> {
  return JSON.parse(body.result?.content?.[0]?.text ?? "null") as Envelope<T>;
}

function authHeaders(session: string | null): HeadersInit {
  return session ? { authorization: `Bearer ${session}` } : {};
}

async function mcpVerify(
  url: string,
  session: string | null,
): Promise<Envelope<SealReport>> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json", ...authHeaders(session) },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: { name: "portico_audit_verify", arguments: {} },
    }),
  });
  return envelope<SealReport>(await response.json() as JsonRpcBody);
}

async function portalVerify(
  url: string,
  session: string | null,
): Promise<{ status: number; body: Envelope<SealReport> }> {
  const response = await fetch(`${url}/api/audit-verify`, { headers: authHeaders(session) });
  return { status: response.status, body: await response.json() as Envelope<SealReport> };
}

async function cliVerify(
  catalog: string,
  identities: string,
  extra: string[] = [],
): Promise<{ code: number; body: Envelope<SealReport> }> {
  const result = await runCli([
    "audit",
    "verify",
    "--catalog",
    catalog,
    "--identities",
    identities,
    ...extra,
  ]);
  return { code: result.code, body: result.stdout as Envelope<SealReport> };
}

function verdict(report: SealReport | undefined, pillar: string): SealVerdict {
  const found = (report?.pillars ?? []).find((item) => item.pillar === pillar);
  if (!found) throw new Error(`report must cover the ${pillar} pillar`);
  return found;
}

interface CatalogFile {
  changes: Array<{ id: string; action: string }>;
  approvals: Array<Record<string, unknown>>;
  seal: unknown[];
}

async function readCatalog(path: string): Promise<CatalogFile> {
  return JSON.parse(await Deno.readTextFile(path)) as CatalogFile;
}

async function writeCatalog(path: string, value: unknown): Promise<void> {
  await Deno.writeTextFile(path, JSON.stringify(value, null, 2));
}

Deno.test("E2E: the seal verifies on all three entrances and names an edited record", async () => {
  const dir = await Deno.makeTempDir({ prefix: "portico-audit-seal-e2e-" });
  const dataDir = `${dir}/data`;
  const catalog = `${dataDir}/catalog.json`;
  const identities = `${dataDir}/identities.json`;
  const sessions = `${dataDir}/sessions.json`;
  const audit = `${dataDir}/gateway-audit.json`;
  const conclusions = `${dataDir}/conclusions.json`;
  await bootstrapRoster(identities, sessions);

  const writerFile = `${dir}/writer.json`;
  await Deno.writeTextFile(writerFile, JSON.stringify(sampleRecord()));
  assertEquals(
    (await runCli([
      "catalog",
      "register",
      "--catalog",
      catalog,
      "--identities",
      identities,
      ...actor("maintainer"),
      "--input",
      writerFile,
    ])).code,
    0,
  );
  assertEquals(
    (await runCli([
      "catalog",
      "publish",
      "--catalog",
      catalog,
      "--identities",
      identities,
      ...actor("maintainer"),
      "--id",
      "docs-writer",
      "--visibility",
      "public",
    ])).code,
    0,
  );
  assertEquals(
    (await runCli([
      "catalog",
      "approve",
      "--catalog",
      catalog,
      "--identities",
      identities,
      ...actor("auditor", "human:security-auditor", "human"),
      "--id",
      "docs-writer",
    ])).code,
    0,
  );
  // A refusal is an audit event too: this one is denied and sealed all the same.
  await runCli([
    "gateway",
    "authorize",
    "--catalog",
    catalog,
    "--identities",
    identities,
    "--audit",
    audit,
    "--id",
    "mcp:not-a-surface",
    ...actor("reader", "human:reader", "human"),
  ]);
  assertEquals(
    (await runCli([
      "audit",
      "conclude",
      "--conclusions",
      conclusions,
      "--catalog",
      catalog,
      "--identities",
      identities,
      ...actor("auditor", "human:security-auditor", "human"),
      "--id",
      "docs-writer",
      "--scope",
      "public_boundary",
      "--verdict",
      "cleared",
    ])).code,
    0,
  );

  const env = {
    PORTICO_CATALOG_PATH: catalog,
    PORTICO_IDENTITIES_PATH: identities,
    PORTICO_SESSIONS_PATH: sessions,
    PORTICO_GATEWAY_AUDIT_PATH: audit,
    PORTICO_CONCLUSIONS_PATH: conclusions,
  };
  const portal = await bootEntrypoint<{ url: string }>(PORTAL, env, PORTAL_PERMS);
  const mcp = await bootEntrypoint<{ url: string }>(MCP, env, MCP_PERMS);
  const auditorSession = sessionFor("human:security-auditor")!;
  const auditorAuth = actor("auditor", "human:security-auditor", "human");
  const readerSession = sessionFor("human:reader")!;
  const readerAuth = actor("reader", "human:reader", "human");

  try {
    const portalUrl = portal.body.data.url;
    const mcpUrl = mcp.body.data.url;

    // 1. Intact: every pillar is sealed, nothing is unsealed, and the three
    //    entrances agree on the tip of every chain.
    const cliOk = await cliVerify(catalog, identities, [
      ...auditorAuth,
      "--audit",
      audit,
      "--conclusions",
      conclusions,
    ]);
    const portalOk = await portalVerify(portalUrl, auditorSession);
    const mcpOk = await mcpVerify(mcpUrl, auditorSession);
    assertEquals(cliOk.code, 0, JSON.stringify(cliOk.body));
    assertEquals(portalOk.status, 200);
    assertEquals(mcpOk.ok, true, JSON.stringify(mcpOk));

    for (
      const [label, report] of [
        ["cli", cliOk.body.data],
        ["portal", portalOk.body.data],
        ["mcp", mcpOk.data],
      ] as const
    ) {
      assertEquals(report?.ok, true, `${label} must report an intact trail`);
      assertEquals(report?.unsealed, 0, `${label} must report no unsealed records`);
      assertEquals(
        (report?.pillars ?? []).map((item) => item.pillar),
        ["catalog", "identity", "gateway", "conclusions"],
        `${label} must cover all four pillars in a stable order`,
      );
    }
    assertEquals(verdict(cliOk.body.data, "catalog").sealed, 3);
    assertEquals(verdict(cliOk.body.data, "gateway").sealed, 1);
    assertEquals(verdict(cliOk.body.data, "conclusions").sealed, 1);
    assert(verdict(cliOk.body.data, "identity").sealed >= 1);
    for (const pillar of ["catalog", "identity", "gateway", "conclusions"]) {
      assertEquals(
        verdict(portalOk.body.data, pillar).tip,
        verdict(cliOk.body.data, pillar).tip,
        `Portal and CLI must agree on the ${pillar} tip`,
      );
      assertEquals(
        verdict(mcpOk.data, pillar).tip,
        verdict(cliOk.body.data, pillar).tip,
        `MCP and CLI must agree on the ${pillar} tip`,
      );
    }

    // 2. Verifying is reading: none of the four pillars is touched by the
    //    question, whichever entrance asks it.
    const sealedCatalog = await Deno.readFile(catalog);
    const pristine = new Map<string, Uint8Array>([
      [catalog, sealedCatalog],
      [identities, await Deno.readFile(identities)],
      [audit, await Deno.readFile(audit)],
      [conclusions, await Deno.readFile(conclusions)],
    ]);
    await cliVerify(catalog, identities, [...auditorAuth, "--audit", audit]);
    await portalVerify(portalUrl, auditorSession);
    await mcpVerify(mcpUrl, auditorSession);
    for (const [path, bytes] of pristine) {
      assertEquals(await Deno.readFile(path), bytes, `verify must not write ${path}`);
    }

    // 3. A record edited on disk stops verifying, and is named.
    const edited = await readCatalog(catalog);
    const target = edited.changes[0];
    target.action = "update";
    await writeCatalog(catalog, edited);

    const cliBroken = await cliVerify(catalog, identities, [...auditorAuth, "--audit", audit]);
    const portalBroken = await portalVerify(portalUrl, auditorSession);
    const mcpBroken = await mcpVerify(mcpUrl, auditorSession);
    for (
      const [label, report] of [
        ["cli", cliBroken.body.data],
        ["portal", portalBroken.body.data],
        ["mcp", mcpBroken.data],
      ] as const
    ) {
      assertEquals(report?.ok, false, `${label} must not bless an edited record`);
      const broken = verdict(report, "catalog");
      assertEquals(broken.ok, false);
      assertEquals(broken.break?.reason, "digest", `${label} break reason`);
      assertEquals(broken.break?.id, target.id, `${label} must name the edited record`);
    }
    assertEquals(portalBroken.status, 200, "a broken seal is a verdict, not a transport error");

    // 4. Only an auditor may ask. A non-auditor learns nothing, and nothing
    //    about the request dirties the trail.
    const brokenBytes = await Deno.readFile(catalog);
    const cliReader = await cliVerify(catalog, identities, [
      ...readerAuth,
      "--audit",
      audit,
    ]);
    const portalReader = await portalVerify(portalUrl, readerSession);
    const mcpReader = await mcpVerify(mcpUrl, readerSession);
    const cliAnon = await cliVerify(catalog, identities, ["--audit", audit]);
    const portalAnon = await portalVerify(portalUrl, null);
    const mcpAnon = await mcpVerify(mcpUrl, null);
    assertEquals(cliReader.code, 1);
    assertEquals(cliReader.body.error?.code, "FORBIDDEN");
    assertEquals(portalReader.status, 403);
    assertEquals(portalReader.body.error?.code, "FORBIDDEN");
    assertEquals(mcpReader.ok, false);
    assertEquals(mcpReader.error?.code, "FORBIDDEN");
    assertEquals(cliAnon.body.error?.code, "FORBIDDEN");
    assertEquals(portalAnon.body.error?.code, "FORBIDDEN");
    assertEquals(mcpAnon.error?.code, "FORBIDDEN");
    assertEquals(
      await Deno.readFile(catalog),
      brokenBytes,
      "a refused verification must not write either",
    );

    // 5. Restoring the bytes restores the verdict: the seal follows content,
    //    not the file's timestamp, so an undo is visible as an undo.
    await Deno.writeFile(catalog, sealedCatalog);
    const restored = await cliVerify(catalog, identities, [...auditorAuth, "--audit", audit]);
    assertEquals(restored.body.data?.ok, true);
    assertEquals(restored.body.data?.unsealed, 0);

    // 6. A record the chain never covered is reported, not blessed. This is the
    //    honest half of the guarantee: the trail cannot hide an insertion, but
    //    it also will not claim an unsealed record was written through it.
    const forged = await readCatalog(catalog);
    forged.approvals.push({
      id: "apr-forged",
      subjectId: "docs-writer",
      decision: "approved",
      actor: { id: "human:attacker", kind: "human" },
      at: "2026-01-01T00:00:00.000Z",
      summary: "inserted behind the store's back",
    });
    await writeCatalog(catalog, forged);

    const cliForged = await cliVerify(catalog, identities, [...auditorAuth, "--audit", audit]);
    const portalForged = await portalVerify(portalUrl, auditorSession);
    const mcpForged = await mcpVerify(mcpUrl, auditorSession);
    for (
      const [label, report] of [
        ["cli", cliForged.body.data],
        ["portal", portalForged.body.data],
        ["mcp", mcpForged.data],
      ] as const
    ) {
      assertEquals(report?.unsealed, 1, `${label} must count the uncovered record`);
      assertEquals(
        verdict(report, "catalog").unsealed.includes("apr-forged"),
        true,
        `${label} must name the uncovered record`,
      );
    }
  } finally {
    await portal.stop();
    await mcp.stop();
  }
});
