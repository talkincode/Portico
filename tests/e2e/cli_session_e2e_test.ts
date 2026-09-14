import { assert, assertEquals } from "../assert.ts";
import { actor, bootstrapRoster, runCli, sampleRecord } from "./harness.ts";

function sessionFlags(token: string, sessions: string) {
  return ["--session", token, "--sessions", sessions];
}

Deno.test("CLI happy path: issued credential login lists the same catalog record as actor flags", async () => {
  const dir = await Deno.makeTempDir({ prefix: "portico-cli-session-e2e-" });
  const identities = `${dir}/identities.json`;
  const sessions = `${dir}/sessions.json`;
  const catalog = `${dir}/catalog.json`;
  const input = `${dir}/record.json`;
  const env = await bootstrapRoster(identities);
  await Deno.writeTextFile(input, `${JSON.stringify(sampleRecord(), null, 2)}\n`);

  const registered = await runCli([
    "catalog",
    "register",
    "--catalog",
    catalog,
    ...actor("maintainer"),
    "--input",
    input,
  ], env);
  assertEquals(registered.code, 0, registered.raw || registered.stderr);

  const issued = await runCli([
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
  assertEquals(issued.code, 0, issued.raw || issued.stderr);
  const issuedBody = issued.stdout as {
    ok: boolean;
    data: { token: string; credentialRef: string; subjectId: string };
  };
  assertEquals(issuedBody.ok, true);
  assertEquals(issuedBody.data.subjectId, "human:reader");
  assert(issuedBody.data.token.startsWith("pct1_"));
  assert(issuedBody.data.credentialRef.startsWith("issued:"));

  const login = await runCli([
    "identity",
    "login",
    "--identities",
    identities,
    "--sessions",
    sessions,
    "--id",
    "human:reader",
    "--token",
    issuedBody.data.token,
  ], env);
  assertEquals(login.code, 0, login.raw || login.stderr);
  const loginBody = login.stdout as {
    ok: boolean;
    data: { token: string; actor: { id: string; role: string } };
  };
  assertEquals(loginBody.data.actor.id, "human:reader");
  assertEquals(loginBody.data.actor.role, "reader");

  const listed = await runCli([
    "catalog",
    "list",
    "--catalog",
    catalog,
    "--identities",
    identities,
    ...sessionFlags(loginBody.data.token, sessions),
  ], env);
  assertEquals(listed.code, 0, listed.raw || listed.stderr);
  const listBody = listed.stdout as { ok: boolean; data: Array<{ id: string }> };
  assertEquals(listBody.data.length, 1);
  assertEquals(listBody.data[0].id, "docs-writer");

  const whoami = await runCli([
    "identity",
    "whoami",
    "--identities",
    identities,
    ...sessionFlags(loginBody.data.token, sessions),
  ], env);
  assertEquals(whoami.code, 0, whoami.raw || whoami.stderr);
  const me = whoami.stdout as { ok: boolean; data: { id: string; role: string } };
  assertEquals(me.data.id, "human:reader");
  assertEquals(me.data.role, "reader");

  const raw = await Deno.readTextFile(sessions);
  assertEquals(raw.includes(issuedBody.data.token), false);
  assertEquals(raw.includes(loginBody.data.token), false);
});

Deno.test("CLI reader session cannot register; failed login writes no session", async () => {
  const dir = await Deno.makeTempDir({ prefix: "portico-cli-session-role-e2e-" });
  const identities = `${dir}/identities.json`;
  const sessions = `${dir}/sessions.json`;
  const catalog = `${dir}/catalog.json`;
  const input = `${dir}/record.json`;
  const env = await bootstrapRoster(identities);
  await Deno.writeTextFile(input, `${JSON.stringify(sampleRecord())}\n`);

  const issued = await runCli([
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
  assertEquals(issued.code, 0, issued.raw || issued.stderr);
  const token = (issued.stdout as { data: { token: string } }).data.token;

  const badLogin = await runCli([
    "identity",
    "login",
    "--identities",
    identities,
    "--sessions",
    sessions,
    "--id",
    "human:reader",
    "--token",
    "pct1_not-a-real-token",
  ], env);
  const beforeFail = JSON.parse(await Deno.readTextFile(sessions)) as {
    sessions: unknown[];
  };
  assertEquals(badLogin.code, 1);
  const badBody = badLogin.stdout as { ok: boolean; error: { code: string } };
  assertEquals(badBody.error.code, "FORBIDDEN");
  // The bootstrap roster already has sessions; a failed login must add none.
  const afterFail = JSON.parse(await Deno.readTextFile(sessions)) as {
    sessions: unknown[];
  };
  assertEquals(afterFail.sessions.length, beforeFail.sessions.length);

  const login = await runCli([
    "identity",
    "login",
    "--identities",
    identities,
    "--sessions",
    sessions,
    "--id",
    "human:reader",
    "--token",
    token,
  ], env);
  assertEquals(login.code, 0, login.raw || login.stderr);
  const sessionToken = (login.stdout as { data: { token: string } }).data.token;

  const registered = await runCli([
    "catalog",
    "register",
    "--catalog",
    catalog,
    "--identities",
    identities,
    ...sessionFlags(sessionToken, sessions),
    "--input",
    input,
  ], env);
  assertEquals(registered.code, 1);
  const forbidden = registered.stdout as { ok: boolean; error: { code: string } };
  assertEquals(forbidden.error.code, "FORBIDDEN");
  let present = true;
  try {
    await Deno.stat(catalog);
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) present = false;
    else throw error;
  }
  assertEquals(present, false);
});

Deno.test("CLI maintainer session cannot approve public; logout then catalog list is forbidden", async () => {
  const dir = await Deno.makeTempDir({ prefix: "portico-cli-session-logout-e2e-" });
  const identities = `${dir}/identities.json`;
  const sessions = `${dir}/sessions.json`;
  const catalog = `${dir}/catalog.json`;
  const input = `${dir}/record.json`;
  const env = await bootstrapRoster(identities);
  await Deno.writeTextFile(input, `${JSON.stringify(sampleRecord())}\n`);

  const issued = await runCli([
    "identity",
    "credential",
    "issue",
    "--identities",
    identities,
    "--sessions",
    sessions,
    ...actor("auditor", "human:security-auditor", "human"),
    "--id",
    "agent:docs-bot",
  ], env);
  assertEquals(issued.code, 0, issued.raw || issued.stderr);
  const login = await runCli([
    "identity",
    "login",
    "--identities",
    identities,
    "--sessions",
    sessions,
    "--id",
    "agent:docs-bot",
    "--token",
    (issued.stdout as { data: { token: string } }).data.token,
  ], env);
  assertEquals(login.code, 0, login.raw || login.stderr);
  const sessionToken = (login.stdout as { data: { token: string } }).data.token;

  const registered = await runCli([
    "catalog",
    "register",
    "--catalog",
    catalog,
    "--identities",
    identities,
    ...sessionFlags(sessionToken, sessions),
    "--input",
    input,
  ], env);
  assertEquals(registered.code, 0, registered.raw || registered.stderr);

  const published = await runCli([
    "catalog",
    "publish",
    "--catalog",
    catalog,
    "--identities",
    identities,
    ...sessionFlags(sessionToken, sessions),
    "--id",
    "docs-writer",
    "--visibility",
    "public",
  ], env);
  assertEquals(published.code, 0, published.raw || published.stderr);

  const approved = await runCli([
    "catalog",
    "approve",
    "--catalog",
    catalog,
    "--identities",
    identities,
    ...sessionFlags(sessionToken, sessions),
    "--id",
    "docs-writer",
  ], env);
  assertEquals(approved.code, 1);
  const body = approved.stdout as { ok: boolean; error: { code: string } };
  assertEquals(body.error.code, "FORBIDDEN");

  const catalogFile = JSON.parse(await Deno.readTextFile(catalog)) as {
    records: Array<{ governanceState: string }>;
    approvals?: unknown[];
  };
  assertEquals(catalogFile.records[0].governanceState, "pending_public");
  assertEquals(catalogFile.approvals ?? [], []);

  const loggedOut = await runCli([
    "identity",
    "logout",
    "--identities",
    identities,
    ...sessionFlags(sessionToken, sessions),
  ], env);
  assertEquals(loggedOut.code, 0, loggedOut.raw || loggedOut.stderr);

  const listed = await runCli([
    "catalog",
    "list",
    "--catalog",
    catalog,
    "--identities",
    identities,
    ...sessionFlags(sessionToken, sessions),
  ], env);
  assertEquals(listed.code, 1);
  const listedBody = listed.stdout as { ok: boolean; error: { code: string } };
  assertEquals(listedBody.error.code, "FORBIDDEN");
});
