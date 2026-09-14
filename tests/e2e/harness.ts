import { assertEquals } from "../assert.ts";

export const ROOT = new URL("../../", import.meta.url).pathname;
export const CLI = `${ROOT}src/cli/main.ts`;

export interface CliResult {
  code: number;
  stdout: unknown;
  raw: string;
  stderr: string;
}

export async function runCli(
  args: string[],
  env: Record<string, string> = {},
): Promise<CliResult> {
  const command = new Deno.Command(Deno.execPath(), {
    args: [
      "run",
      "--allow-read",
      "--allow-write",
      "--allow-env",
      CLI,
      ...args,
    ],
    cwd: ROOT,
    env: { ...Deno.env.toObject(), ...env },
    stdout: "piped",
    stderr: "piped",
  });
  const output = await command.output();
  const raw = new TextDecoder().decode(output.stdout).trim();
  const stderr = new TextDecoder().decode(output.stderr);
  let stdout: unknown = null;
  if (raw) {
    try {
      stdout = JSON.parse(raw);
    } catch {
      stdout = raw;
    }
  }
  return { code: output.code, stdout, raw, stderr };
}

/**
 * Session tokens, keyed by identity id, for the roster bootstrapped in this
 * test process. `actor()` reads from here, so every call site that used to
 * claim an identity now proves one instead — and it carries the session file
 * that token lives in, because a session is meaningless without it.
 */
const SESSIONS = new Map<string, { token: string; sessions: string }>();

export function sessionFor(id: string): string | undefined {
  return SESSIONS.get(id)?.token;
}

/**
 * Flags that authenticate as `id`.
 *
 * The `role`/`kind` parameters are kept so existing call sites read the same,
 * but they no longer *grant* anything: the session decides the role, and a
 * test that wants an auditor cannot get one by asking for it.
 */
export function actor(role: string, id = "agent:docs-bot", kind = "agent"): string[] {
  // Anonymous is the absence of proof, not a claim: passing no session is
  // exactly how an unauthenticated caller is expressed now.
  if (role === "anonymous") return [];
  const entry = SESSIONS.get(id);
  if (!entry) {
    throw new Error(
      `no session for '${id}' (${kind}/${role}); call bootstrapRoster() or loginAs() first`,
    );
  }
  return ["--sessions", entry.sessions, "--session", entry.token];
}

export function sessionsPathFor(identities: string): string {
  return identities.replace(/identities\.json$/, "sessions.json");
}

/** Bootstrap-issues a credential and logs in, returning the session token. */
export async function loginAs(
  identities: string,
  sessions: string,
  id: string,
  as: string[] = [],
): Promise<string> {
  const issued = await runCli([
    "identity",
    "credential",
    "issue",
    "--identities",
    identities,
    "--sessions",
    sessions,
    ...as,
    "--id",
    id,
  ]);
  assertEquals(issued.code, 0, issued.raw || issued.stderr);
  const credential = (issued.stdout as { data?: { token?: string } }).data?.token ?? "";

  const loggedIn = await runCli([
    "identity",
    "login",
    "--identities",
    identities,
    "--sessions",
    sessions,
    "--id",
    id,
    "--token",
    credential,
  ]);
  assertEquals(loggedIn.code, 0, loggedIn.raw || loggedIn.stderr);
  const token = (loggedIn.stdout as { data?: { token?: string } }).data?.token ?? "";
  SESSIONS.set(id, { token, sessions });
  return token;
}

export function sampleRecord() {
  return {
    id: "docs-writer",
    name: "Docs Writer",
    description: "Drafts internal documentation.",
    channels: ["cli"],
    version: "1.0.0",
    visibility: "internal",
    entry: { kind: "package", value: "jsr:@example/docs-writer" },
    maintainers: [{ id: "agent:docs-bot", kind: "agent" }],
  };
}

export function sampleMcpRecord() {
  return {
    id: "docs-mcp",
    name: "Docs MCP",
    description: "External documentation MCP server.",
    channels: ["mcp"],
    version: "1.0.0",
    visibility: "internal",
    entry: { kind: "mcp_endpoint", value: "https://mcp.example.test/servers/docs" },
    maintainers: [{ id: "agent:docs-bot", kind: "agent" }],
  };
}

export function sampleWebRecord() {
  return {
    id: "docs-web",
    name: "Docs Web",
    description: "External documentation portal.",
    channels: ["web"],
    version: "1.0.0",
    visibility: "internal",
    entry: { kind: "url", value: "https://docs.example.test/portals/docs-writer" },
    maintainers: [{ id: "agent:docs-bot", kind: "agent" }],
  };
}

/**
 * Grants the standard test roster and signs every identity in.
 *
 * The first grant needs no actor (an empty roster bootstraps its first human
 * auditor), the first credential is the one-time bootstrap, and every later
 * grant and issuance is performed by the auditor's real session.
 */
export async function bootstrapRoster(
  identities: string,
  sessions = sessionsPathFor(identities),
): Promise<Record<string, string>> {
  const first = await runCli([
    "identity",
    "grant",
    "--identities",
    identities,
    "--id",
    "human:security-auditor",
    "--kind",
    "human",
    "--role",
    "auditor",
  ]);
  assertEquals(first.code, 0, first.raw || first.stderr);

  // The one-time handoff that turns the roster into a trust root.
  await loginAs(identities, sessions, "human:security-auditor");

  const grants: Array<[string, string, string]> = [
    ["agent:docs-bot", "agent", "maintainer"],
    ["human:docs-owner", "human", "maintainer"],
    ["human:reader", "human", "reader"],
    ["human:auditor", "human", "reader"],
  ];
  for (const [id, kind, role] of grants) {
    const result = await runCli([
      "identity",
      "grant",
      "--identities",
      identities,
      "--sessions",
      sessions,
      ...actor("auditor", "human:security-auditor", "human"),
      "--id",
      id,
      "--kind",
      kind,
      "--role",
      role,
    ]);
    assertEquals(result.code, 0, result.raw || result.stderr);
  }

  for (const [id] of grants) {
    await loginAs(identities, sessions, id, actor("auditor", "human:security-auditor", "human"));
  }

  return {
    PORTICO_IDENTITIES_PATH: identities,
    PORTICO_SESSIONS_PATH: sessions,
  };
}
