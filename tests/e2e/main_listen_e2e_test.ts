import { assert, assertEquals } from "../assert.ts";
import { ROOT } from "./harness.ts";

interface ListenLine {
  ok: boolean;
  data?: { url: string };
  error?: { code: string; message: string };
}

async function startMain(
  kind: "portal" | "gateway",
): Promise<{ child: Deno.ChildProcess; line: ListenLine }> {
  const dir = await Deno.makeTempDir({ prefix: `portico-${kind}-main-` });
  const env: Record<string, string> = {
    ...Deno.env.toObject(),
    PORTICO_BIND: "127.0.0.1",
    PORTICO_PORT: "0",
    PORTICO_CATALOG_PATH: `${dir}/catalog.json`,
    PORTICO_IDENTITIES_PATH: `${dir}/identities.json`,
    PORTICO_SESSIONS_PATH: `${dir}/sessions.json`,
  };
  if (kind === "gateway") {
    env.PORTICO_GATEWAY_AUDIT_PATH = `${dir}/gateway-audit.json`;
  }
  const allow = kind === "portal"
    ? ["--allow-read", "--allow-env", "--allow-net=127.0.0.1"]
    : ["--allow-read", "--allow-write", "--allow-env", "--allow-net=127.0.0.1"];
  const child = new Deno.Command(Deno.execPath(), {
    args: ["run", ...allow, `${ROOT}src/${kind}/main.ts`],
    cwd: ROOT,
    env,
    stdout: "piped",
    stderr: "piped",
  }).spawn();
  const decoder = new TextDecoder();
  const reader = child.stdout.getReader();
  let buf = "";
  const deadline = Date.now() + 8000;
  try {
    while (Date.now() < deadline) {
      const remaining = Math.max(1, deadline - Date.now());
      const result = await Promise.race([
        reader.read(),
        new Promise<{ done: true; value: undefined }>((resolve) =>
          setTimeout(() => resolve({ done: true, value: undefined }), remaining)
        ),
      ]);
      if (result.done && !result.value) break;
      if (result.value) buf += decoder.decode(result.value);
      const match = buf.split("\n").find((row) => row.trim().startsWith("{"));
      if (match) {
        return { child, line: JSON.parse(match) as ListenLine };
      }
      if (result.done) break;
    }
    throw new Error(`${kind} main produced no JSON listen line: ${buf}`);
  } catch (error) {
    child.kill("SIGTERM");
    await child.status;
    throw error;
  }
}

async function stopMain(child: Deno.ChildProcess): Promise<void> {
  try {
    child.kill("SIGTERM");
  } catch {
    // already exited
  }
  await child.status;
  await child.stdout.cancel().catch(() => {});
  await child.stderr.cancel().catch(() => {});
}

Deno.test("E2E: portal main listens on loopback without touching server before init", async () => {
  const { child, line } = await startMain("portal");
  try {
    assertEquals(line.ok, true, JSON.stringify(line));
    assert(line.data?.url?.startsWith("http://127.0.0.1:"), line.data?.url);
  } finally {
    await stopMain(child);
  }
});

Deno.test("E2E: gateway main listens on loopback without touching server before init", async () => {
  const { child, line } = await startMain("gateway");
  try {
    assertEquals(line.ok, true, JSON.stringify(line));
    assert(line.data?.url?.startsWith("http://127.0.0.1:"), line.data?.url);
  } finally {
    await stopMain(child);
  }
});
