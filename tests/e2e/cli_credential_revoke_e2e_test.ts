import { assert, assertEquals } from "../assert.ts";
import { listenPortal, portalUrl } from "../../src/portal/mod.ts";
import { actor, bootstrapRoster, runCli, sampleRecord } from "./harness.ts";

interface JsonBody {
  ok: boolean;
  data?: unknown;
  error?: { code: string; message: string };
}

interface AuditEvent {
  id: string;
  kind: string;
  action: string;
  subjectId: string;
  summary: string;
}

async function expectOk(
  args: string[],
  env: Record<string, string> = {},
): Promise<JsonBody> {
  const result = await runCli(args, env);
  assertEquals(result.code, 0, result.raw || result.stderr);
  const body = result.stdout as JsonBody;
  assertEquals(body.ok, true, result.raw);
  return body;
}

async function expectCode(
  args: string[],
  code: string,
  env: Record<string, string> = {},
): Promise<JsonBody> {
  const result = await runCli(args, env);
  assert(result.code !== 0, `expected failure but got: ${result.raw}`);
  const body = result.stdout as JsonBody;
  assertEquals(body.ok, false, result.raw);
  assertEquals(body.error?.code, code, result.raw);
  return body;
}

async function withPortal(
  catalog: string,
  identities: string,
  sessions: string,
  fn: (base: string) => Promise<void>,
): Promise<void> {
  const controller = new AbortController();
  const server = listenPortal({
    catalogPath: catalog,
    identitiesPath: identities,
    sessionsPath: sessions,
    hostname: "127.0.0.1",
    port: 0,
    signal: controller.signal,
  });
  try {
    await fn(portalUrl(server));
  } finally {
    controller.abort();
    await server.finished;
  }
}

Deno.test("CLI happy path: auditor revokes credentials; session dies, roster identity remains", async () => {
  const dir = await Deno.makeTempDir({ prefix: "portico-cred-revoke-e2e-" });
  const identities = `${dir}/identities.json`;
  const sessions = `${dir}/sessions.json`;
  const catalog = `${dir}/catalog.json`;
  const input = `${dir}/record.json`;
  const env = await bootstrapRoster(identities);
  await Deno.writeTextFile(input, `${JSON.stringify(sampleRecord(), null, 2)}\n`);

  await expectOk([
    "catalog",
    "register",
    "--catalog",
    catalog,
    ...actor("maintainer"),
    "--input",
    input,
  ], env);

  const issued = await expectOk([
    "identity",
    "credential",
    "issue",
    "--sessions",
    sessions,
    ...actor("auditor", "human:security-auditor", "human"),
    "--id",
    "human:reader",
  ], env);
  const issuedBody = issued.data as { token: string; subjectId: string };
  assertEquals(issuedBody.subjectId, "human:reader");
  assert(issuedBody.token.startsWith("pct1_"));

  const login = await expectOk([
    "identity",
    "login",
    "--sessions",
    sessions,
    "--id",
    "human:reader",
    "--token",
    issuedBody.token,
  ], env);
  const loginBody = login.data as { token: string };
  assert(loginBody.token.startsWith("pst1_"));

  const listed = await expectOk([
    "catalog",
    "list",
    "--catalog",
    catalog,
    "--sessions",
    sessions,
    "--session",
    loginBody.token,
  ], env);
  const listBody = listed.data as Array<{ id: string }>;
  assertEquals(listBody.some((item) => item.id === "docs-writer"), true);

  await withPortal(catalog, identities, sessions, async (base) => {
    const response = await fetch(`${base}/api/catalog`, {
      headers: { authorization: `Bearer ${loginBody.token}` },
    });
    const body = await response.json() as JsonBody;
    assertEquals(response.status, 200);
    assertEquals(body.ok, true);
    assertEquals(
      (body.data as Array<{ id: string }>).some((item) => item.id === "docs-writer"),
      true,
    );
  });

  const revoked = await expectOk([
    "identity",
    "credential",
    "revoke",
    "--sessions",
    sessions,
    ...actor("auditor", "human:security-auditor", "human"),
    "--id",
    "human:reader",
  ], env);
  const revokedBody = revoked.data as {
    subjectId: string;
    revokedCredentials: number;
    revokedSessions: number;
    identityRemains: boolean;
  };
  assertEquals(revokedBody.subjectId, "human:reader");
  // The bootstrap roster already issued one credential per identity, and the
  // test issues another for the reader; revocation must catch every active one
  // rather than a hardcoded count.
  assert(revokedBody.revokedCredentials >= 2);
  assert(revokedBody.revokedSessions >= 1);
  assertEquals(revokedBody.identityRemains, true);

  await expectCode(
    [
      "catalog",
      "list",
      "--catalog",
      catalog,
      "--sessions",
      sessions,
      "--session",
      loginBody.token,
    ],
    "FORBIDDEN",
    env,
  );

  await expectCode(
    [
      "identity",
      "login",
      "--sessions",
      sessions,
      "--id",
      "human:reader",
      "--token",
      issuedBody.token,
    ],
    "FORBIDDEN",
    env,
  );

  // This is not `identity revoke`: the subject is still on the roster and can
  // be re-credentialed. Until it is, it has no surface at all — proving an
  // identity is the only way in, so cutting credentials cuts everything.
  const reissued = await expectOk([
    "identity",
    "credential",
    "issue",
    "--identities",
    identities,
    "--sessions",
    sessions,
    ...actor("auditor", "human:security-auditor", "human"),
    "--id",
    "human:reader",
  ], env);
  const freshToken = (reissued.data as { token: string }).token;

  const relogin = await expectOk([
    "identity",
    "login",
    "--identities",
    identities,
    "--sessions",
    sessions,
    "--id",
    "human:reader",
    "--token",
    freshToken,
  ], env);
  const freshSession = (relogin.data as { token: string }).token;

  const stillListed = await expectOk([
    "catalog",
    "list",
    "--catalog",
    catalog,
    "--sessions",
    sessions,
    "--session",
    freshSession,
  ], env);
  assertEquals(
    (stillListed.data as Array<{ id: string }>).some((item) => item.id === "docs-writer"),
    true,
  );

  const roster = await expectOk([
    "identity",
    "list",
    ...actor("auditor", "human:security-auditor", "human"),
  ], env);
  assertEquals(
    (roster.data as Array<{ id: string }>).some((item) => item.id === "human:reader"),
    true,
  );

  const audit = await expectOk([
    "audit",
    "list",
    "--catalog",
    catalog,
    ...actor("auditor", "human:security-auditor", "human"),
  ], env);
  const events = audit.data as AuditEvent[];
  assertEquals(
    events.some((item) =>
      item.kind === "credential" &&
      item.action === "revoke_credential" &&
      item.subjectId === "human:reader"
    ),
    true,
  );

  await withPortal(catalog, identities, sessions, async (base) => {
    const response = await fetch(`${base}/api/catalog`, {
      headers: { authorization: `Bearer ${loginBody.token}` },
    });
    const body = await response.json() as JsonBody;
    assert(response.status >= 400);
    assertEquals(body.ok, false);
    assertEquals(body.error?.code, "FORBIDDEN");
  });
});

Deno.test("CLI: maintainer cannot revoke credentials; identity and session files stay unchanged", async () => {
  const dir = await Deno.makeTempDir({ prefix: "portico-cred-revoke-forbidden-e2e-" });
  const identities = `${dir}/identities.json`;
  const sessions = `${dir}/sessions.json`;
  const env = await bootstrapRoster(identities);

  await expectOk([
    "identity",
    "credential",
    "issue",
    "--sessions",
    sessions,
    ...actor("auditor", "human:security-auditor", "human"),
    "--id",
    "human:reader",
  ], env);
  const identityBefore = await Deno.readTextFile(identities);
  const sessionBefore = await Deno.readTextFile(sessions);

  await expectCode(
    [
      "identity",
      "credential",
      "revoke",
      "--sessions",
      sessions,
      ...actor("maintainer"),
      "--id",
      "human:reader",
    ],
    "FORBIDDEN",
    env,
  );

  assertEquals(await Deno.readTextFile(identities), identityBefore);
  assertEquals(await Deno.readTextFile(sessions), sessionBefore);
});
