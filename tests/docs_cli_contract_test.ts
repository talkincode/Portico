import { assert, assertEquals } from "./assert.ts";
import { AccessService, MemoryIdentityStore, MemorySessionStore } from "../src/access/mod.ts";

/**
 * Two things the handbook promised and the code did not do.
 *
 * 1. Every command in the docs is written `deno task cli -- <command> …`. The
 *    task runner hands that `--` to the CLI verbatim, where it was read as a
 *    flag named "" and swallowed the next word — so `deno task cli -- identity
 *    grant …` answered `unknown command 'grant'`, and every copy-pasted command
 *    in `docs/` and `README.md` failed. The parser treats a bare `--` as the
 *    separator it is; this test runs the documented form through the real task.
 * 2. The bootstrap docs printed `{"data":{"session":"pst1_…"}}`. The CLI prints
 *    `data.token` (and `data.token` for a credential too), so a reader that
 *    pulled the field the docs named passed an empty `--session` and every
 *    later command failed with `USAGE`. The examples are compared against the
 *    payload the services actually return.
 */

const ROOT = new URL("../", import.meta.url).pathname;

/** Runs `deno task cli -- …` exactly as the docs spell it. */
async function taskCli(args: string[]): Promise<{ code: number; stdout: string }> {
  const command = new Deno.Command(Deno.execPath(), {
    args: ["task", "cli", "--", ...args],
    cwd: ROOT,
    stdout: "piped",
    stderr: "piped",
  });
  const { code, stdout } = await command.output();
  return { code, stdout: new TextDecoder().decode(stdout).trim() };
}

Deno.test("E2E: the documented `deno task cli -- …` form reaches the command", async () => {
  const dir = await Deno.makeTempDir({ prefix: "portico-docs-cli-" });
  const identities = `${dir}/identities.json`;

  // The first command of the documented bootstrap, verbatim.
  const granted = await taskCli([
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
  assertEquals(
    granted.code,
    0,
    `the documented form must reach the command, got: ${granted.stdout}`,
  );
  const body = JSON.parse(granted.stdout) as { ok: boolean; data?: { id?: string } };
  assertEquals(body.ok, true);
  assertEquals(body.data?.id, "human:security-auditor");
});

/** Keys of the first `{…}` group in `text` at brace `depth` (1 = the group itself). */
function keysAtDepth(text: string, wanted: number): string[] {
  const start = text.indexOf("{");
  assert(start >= 0, "no JSON object in the documented example");
  const keys: string[] = [];
  let depth = 0;
  let inString = false;
  let escaped = false;
  let current = "";
  for (let i = start; i < text.length; i += 1) {
    const char = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') {
        inString = false;
        // A string is a key only when a colon follows it: values are strings
        // too, and the examples are full of placeholder values.
        let next = i + 1;
        while (/\s/.test(text[next] ?? "")) next += 1;
        if (depth === wanted && text[next] === ":") keys.push(current);
      } else if (depth === wanted) current += char;
      continue;
    }
    if (char === '"') {
      inString = true;
      current = "";
      continue;
    }
    if (char === "{") depth += 1;
    else if (char === "}") {
      depth -= 1;
      if (depth === 0) break;
    }
  }
  return keys;
}

/**
 * The payload keys an example names. An example may be the CLI envelope
 * (`{"ok":true,"data":{…}}`) or the payload alone; both are read the same way.
 */
function documentedPayloadKeys(text: string): string[] {
  const outer = keysAtDepth(text, 1);
  return outer.includes("data") ? keysAtDepth(text, 2) : outer;
}

/**
 * The example a reader copies for `command`, i.e. the first `{…}` group after
 * that command line and before the next command. Both documented shapes work:
 * a fenced `json` block (bootstrap.md) and a `# 控制台输出：{…}` comment
 * (quickstart.md).
 */
function documentedExample(text: string, command: string): string {
  const at = text.indexOf(command);
  assert(at >= 0, `${command} must appear in the doc`);
  const rest = text.slice(at + command.length);
  const nextCommand = rest.search(/\ndeno task cli/);
  const window = nextCommand < 0 ? rest : rest.slice(0, nextCommand);
  const brace = window.indexOf("{");
  assert(brace >= 0, `no output example follows ${command}`);
  return window.slice(brace);
}

const EXAMPLES = [
  { file: "docs/intro/quickstart.md", command: "identity credential issue" },
  { file: "docs/intro/quickstart.md", command: "identity login" },
  { file: "docs/access/bootstrap.md", command: "identity credential issue" },
  { file: "docs/access/bootstrap.md", command: "identity login" },
];

Deno.test("the bootstrap docs name the fields the CLI actually prints", async () => {
  // The real payloads, from the same services the CLI prints.
  const access = new AccessService(new MemoryIdentityStore(), new MemorySessionStore());
  await access.grant(null, { id: "human:security-auditor", kind: "human", role: "auditor" });
  const issued = await access.issueCredential(null, { id: "human:security-auditor" });
  const session = await access.login({
    id: "human:security-auditor",
    token: issued.token,
  });

  for (const example of EXAMPLES) {
    const text = await Deno.readTextFile(`${ROOT}${example.file}`);
    const keys = documentedPayloadKeys(documentedExample(text, example.command));
    assert(keys.length > 0, `${example.file} must show the output of ${example.command}`);
    const real = example.command === "identity login" ? Object.keys(session) : Object.keys(issued);
    for (const key of keys) {
      assert(
        real.includes(key),
        `${example.file} documents '${key}' as a field of ${example.command}, but the real ` +
          `payload has ${real.join(", ")}`,
      );
    }
    if (example.command === "identity login") {
      assert(
        keys.includes("token"),
        `${example.file} must say where the session token is (data.token)`,
      );
    }
  }
});
