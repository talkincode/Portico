import { assert, assertEquals } from "../assert.ts";
import { actor, bootstrapRoster, runCli, sampleRecord } from "./harness.ts";

interface JsonBody {
  ok: boolean;
  data?: unknown;
  error?: { code: string; message: string };
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

Deno.test("CLI happy path: auditor revokes maintainer; catalog they wrote stays, they cannot write again", async () => {
  const dir = await Deno.makeTempDir({ prefix: "portico-revoke-e2e-" });
  const identities = `${dir}/identities.json`;
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

  const revoked = await expectOk([
    "identity",
    "revoke",
    "--id",
    "agent:docs-bot",
    ...actor("auditor", "human:security-auditor", "human"),
  ], env);
  const revokedBody = revoked.data as {
    subjectId: string;
    role: string;
    revoked: boolean;
  };
  assertEquals(revokedBody.subjectId, "agent:docs-bot");
  assertEquals(revokedBody.role, "maintainer");
  assertEquals(revokedBody.revoked, true);

  await expectCode(
    [
      "catalog",
      "register",
      "--catalog",
      catalog,
      ...actor("maintainer"),
      "--input",
      input,
    ],
    "FORBIDDEN",
    env,
  );

  const listed = await expectOk([
    "catalog",
    "list",
    "--catalog",
    catalog,
    ...actor("reader", "human:reader", "human"),
  ], env);
  const records = listed.data as Array<{ id: string }>;
  assertEquals(records.length, 1);
  assertEquals(records[0].id, "docs-writer");

  const identitiesListed = await expectOk([
    "identity",
    "list",
    ...actor("auditor", "human:security-auditor", "human"),
  ], env);
  const people = identitiesListed.data as Array<{ id: string }>;
  assertEquals(people.some((item) => item.id === "agent:docs-bot"), false);

  const audit = await expectOk([
    "audit",
    "list",
    "--catalog",
    catalog,
    ...actor("auditor", "human:security-auditor", "human"),
  ], env);
  const events = audit.data as Array<{ kind: string; action: string; subjectId: string }>;
  assertEquals(
    events.some((item) =>
      item.kind === "revoke" && item.action === "revoke" && item.subjectId === "agent:docs-bot"
    ),
    true,
  );
});

Deno.test("CLI maintainer cannot revoke; identity file bytes stay unchanged", async () => {
  const dir = await Deno.makeTempDir({ prefix: "portico-revoke-forbidden-e2e-" });
  const identities = `${dir}/identities.json`;
  const env = await bootstrapRoster(identities);
  const before = await Deno.readTextFile(identities);

  await expectCode(
    [
      "identity",
      "revoke",
      "--id",
      "human:reader",
      ...actor("maintainer"),
    ],
    "FORBIDDEN",
    env,
  );

  assertEquals(await Deno.readTextFile(identities), before);
});

Deno.test("CLI last human auditor cannot revoke themselves; roster stays", async () => {
  const dir = await Deno.makeTempDir({ prefix: "portico-revoke-last-e2e-" });
  const identities = `${dir}/identities.json`;
  const env = await bootstrapRoster(identities);
  const before = await Deno.readTextFile(identities);

  await expectCode(
    [
      "identity",
      "revoke",
      "--id",
      "human:security-auditor",
      ...actor("auditor", "human:security-auditor", "human"),
    ],
    "INVALID_STATE",
    env,
  );

  assertEquals(await Deno.readTextFile(identities), before);
});

Deno.test("CLI revoked session cannot act; failed revoke does not drop the session", async () => {
  const dir = await Deno.makeTempDir({ prefix: "portico-revoke-session-e2e-" });
  const identities = `${dir}/identities.json`;
  const sessions = `${dir}/sessions.json`;
  const catalog = `${dir}/catalog.json`;
  const env = await bootstrapRoster(identities);
  env.PORTICO_SESSIONS_PATH = sessions;

  const issued = await expectOk([
    "identity",
    "credential",
    "issue",
    "--id",
    "human:reader",
    ...actor("auditor", "human:security-auditor", "human"),
  ], env);
  const token = (issued.data as { token: string }).token;

  const login = await expectOk([
    "identity",
    "login",
    "--id",
    "human:reader",
    "--token",
    token,
  ], env);
  const session = (login.data as { token: string }).token;

  const listed = await expectOk([
    "catalog",
    "list",
    "--catalog",
    catalog,
    "--session",
    session,
  ], env);
  assertEquals((listed.data as unknown[]).length, 0);

  const beforeSessions = await Deno.readTextFile(sessions);
  await expectCode(
    [
      "identity",
      "revoke",
      "--id",
      "human:reader",
      ...actor("maintainer"),
    ],
    "FORBIDDEN",
    env,
  );
  assertEquals(await Deno.readTextFile(sessions), beforeSessions);

  await expectOk([
    "identity",
    "revoke",
    "--id",
    "human:reader",
    ...actor("auditor", "human:security-auditor", "human"),
  ], env);

  await expectCode(
    [
      "catalog",
      "list",
      "--catalog",
      catalog,
      "--session",
      session,
    ],
    "FORBIDDEN",
    env,
  );
});
