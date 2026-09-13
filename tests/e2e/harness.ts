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

export function actor(role: string, id = "agent:docs-bot", kind = "agent") {
  return [
    "--actor-id",
    id,
    "--actor-kind",
    kind,
    "--actor-role",
    role,
  ];
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

export async function bootstrapRoster(identities: string): Promise<Record<string, string>> {
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

  return { PORTICO_IDENTITIES_PATH: identities };
}
