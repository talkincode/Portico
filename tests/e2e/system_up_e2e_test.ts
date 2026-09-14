import { assert, assertEquals } from "../assert.ts";
import { actor, bootstrapRoster, ROOT, runCli, sampleMcpRecord, sessionFor } from "./harness.ts";
import { bootEntrypoint, type JsonBody } from "./process.ts";

/**
 * The whole system, started the way an operator starts it.
 *
 * This is the acceptance test for "Portico is runnable": on an empty machine,
 * one command brings up both halves, the governance flow reaches both of them,
 * a restart keeps the state, and stopping the supervisor actually stops the
 * children. Everything here goes through the shipped `up` entrypoint rather
 * than `listenPortal` / `listenGateway`, so a broken supervisor fails the test.
 */

const UP = `${ROOT}src/up/main.ts`;

// `up` only spawns and supervises: it never binds a socket and never touches
// governance data itself, so it needs exactly these two permissions.
const UP_PERMS: readonly string[] = ["--allow-env", "--allow-run"];

interface UpData {
  dataDir: string;
  portal: { url: string };
  gateway: { url: string };
  mcp: { url: string };
}

async function startUp(dataDir: string) {
  return await bootEntrypoint<UpData>(UP, {
    PORTICO_DATA_DIR: dataDir,
    PORTICO_GATEWAY_PORT: "0",
  }, UP_PERMS);
}

async function reachable(url: string): Promise<boolean> {
  try {
    await fetch(url);
    return true;
  } catch {
    return false;
  }
}

Deno.test("E2E: `up` brings the system live on an empty machine and survives a restart", async () => {
  const dir = await Deno.makeTempDir({ prefix: "portico-up-e2e-" });
  // Deliberately never pre-created: a fresh operator has no data directory.
  const dataDir = `${dir}/data`;
  const catalog = `${dataDir}/catalog.json`;
  const identities = `${dataDir}/identities.json`;
  const sessions = `${dataDir}/sessions.json`;

  // ── seed one governed, approved-public MCP surface ───────────────────
  await bootstrapRoster(identities, sessions);
  const auditor = actor("auditor", "human:security-auditor", "human");
  const maintainer = actor("maintainer", "agent:docs-bot");

  const record = `${dir}/mcp.json`;
  await Deno.writeTextFile(record, JSON.stringify(sampleMcpRecord()));
  const registered = await runCli([
    "catalog",
    "register",
    "--catalog",
    catalog,
    "--identities",
    identities,
    ...maintainer,
    "--input",
    record,
  ]);
  assertEquals(registered.code, 0, registered.raw);

  const submitted = await runCli([
    "catalog",
    "publish",
    "--catalog",
    catalog,
    "--identities",
    identities,
    ...maintainer,
    "--id",
    "docs-mcp",
    "--visibility",
    "public",
  ]);
  assertEquals(submitted.code, 0, submitted.raw);

  const approved = await runCli([
    "catalog",
    "approve",
    "--catalog",
    catalog,
    "--identities",
    identities,
    ...auditor,
    "--id",
    "docs-mcp",
  ]);
  assertEquals(approved.code, 0, approved.raw);

  // ── first run ────────────────────────────────────────────────────────
  const first = await startUp(dataDir);
  let portalUrl = "";
  let gatewayUrl = "";
  let mcpUrl = "";
  try {
    assertEquals(first.body.data.dataDir, dataDir);
    portalUrl = first.body.data.portal.url;
    gatewayUrl = first.body.data.gateway.url;
    mcpUrl = first.body.data.mcp.url;
    assertEquals(
      new Set([portalUrl, gatewayUrl, mcpUrl]).size,
      3,
      "each entrance must bind its own port",
    );

    const publicPage = await fetch(`${portalUrl}/public`);
    assertEquals(publicPage.status, 200);
    assert(
      (await publicPage.text()).includes("Docs MCP"),
      "the approved surface must appear on the public plane",
    );

    // The public surface is reachable anonymously, through the Gateway.
    const route = await fetch(`${gatewayUrl}/gateway/mcp/docs-mcp/authorize`, {
      method: "POST",
    });
    const routeBody = await route.json() as JsonBody<{ connect?: { mode: string } }>;
    assertEquals(route.status, 200);
    assertEquals(routeBody.data?.connect?.mode, "direct");

    // …and discoverable anonymously, through MCP.
    const listed = await fetch(mcpUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: { name: "portico_list", arguments: {} },
      }),
    });
    const listedBody = await listed.json() as {
      result?: { content?: Array<{ text: string }> };
    };
    const envelope = JSON.parse(
      listedBody.result?.content?.[0]?.text ?? "null",
    ) as { ok: boolean; data?: Array<{ id: string }> };
    assertEquals(envelope.ok, true);
    assertEquals(envelope.data?.map((item) => item.id), ["docs-mcp"]);

    // The Gateway just recorded an access event. `up` hands the same audit path
    // to every entrance, so the auditor timeline must carry it on both the
    // Portal and MCP — not just on `audit list --audit`.
    const auditor = sessionFor("human:security-auditor")!;
    const portalAudit = await fetch(`${portalUrl}/api/audit`, {
      headers: { authorization: `Bearer ${auditor}` },
    });
    const portalEvents = (await portalAudit.json() as JsonBody<Array<{ kind: string }>>).data ?? [];
    assert(
      portalEvents.some((event) => event.kind === "gateway"),
      `the Portal timeline must include the Gateway access event; got ${
        JSON.stringify(portalEvents.map((event) => event.kind))
      }`,
    );

    const mcpAudit = await fetch(mcpUrl, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${auditor}`,
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 2,
        method: "tools/call",
        params: { name: "portico_audit", arguments: {} },
      }),
    });
    const mcpBody = await mcpAudit.json() as {
      result?: { content?: Array<{ text: string }> };
    };
    const mcpEnvelope = JSON.parse(mcpBody.result?.content?.[0]?.text ?? "null") as {
      ok: boolean;
      data?: Array<{ kind: string }>;
    };
    assertEquals(mcpEnvelope.ok, true);
    assert(
      (mcpEnvelope.data ?? []).some((event) => event.kind === "gateway"),
      "the MCP timeline must include the Gateway access event",
    );
    assertEquals(
      (mcpEnvelope.data ?? []).length,
      portalEvents.length,
      "Portal and MCP must show the same timeline",
    );
  } finally {
    await first.stop();
  }

  // Stopping the supervisor must reap the children, not orphan them.
  assert(!(await reachable(portalUrl)), "the portal port is still open after shutdown");
  assert(!(await reachable(gatewayUrl)), "the gateway port is still open after shutdown");

  // ── second run: the same data directory still holds the governance state ──
  const second = await startUp(dataDir);
  try {
    const publicPage = await fetch(`${second.body.data.portal.url}/public`);
    assertEquals(publicPage.status, 200);
    assert(
      (await publicPage.text()).includes("Docs MCP"),
      "state must survive a full restart of the system",
    );
    // The gateway audit file lands beside the rest of the state.
    const audit = await fetch(`${second.body.data.gateway.url}/gateway/audit`);
    assertEquals(audit.status, 403);
  } finally {
    await second.stop();
  }
});
