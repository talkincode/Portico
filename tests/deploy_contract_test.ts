import { assert, assertEquals } from "./assert.ts";
import { gatewayPerms, netAllow, readOnlyHttpPerms } from "../src/perms.ts";

/**
 * The deployment's permission allow-list used to live only on the server. When
 * the store layer started calling `Deno.mkdir`, it needed write access to the
 * *directory* while the deployed grant covered two specific files — so every
 * Gateway audit append started failing with a 500 on the live host, and no test
 * could see it because the tests granted `--allow-write` broadly.
 *
 * The scripts are versioned now, and this test pins the shape that the code
 * depends on. It checks permission *classes* rather than exact strings, because
 * the deployment is deliberately narrower than `src/perms.ts` (it scopes
 * `--allow-read` to `/app`).
 */

const ROOT = new URL("../", import.meta.url).pathname;

interface Contract {
  file: string;
  entry: string;
  writable: boolean;
  defaultPort: number;
}

const CONTRACTS: Record<string, Contract> = {
  portal: {
    file: "deploy/run-portal.sh",
    entry: "src/portal/main.ts",
    writable: false,
    defaultPort: 8788,
  },
  mcp: { file: "deploy/run-mcp.sh", entry: "src/mcp/main.ts", writable: false, defaultPort: 8790 },
  gateway: {
    file: "deploy/run-gateway.sh",
    entry: "src/gateway/main.ts",
    writable: true,
    defaultPort: 8789,
  },
};

/** Collapses shell line continuations and expands the two variables we assert on. */
async function script(name: string): Promise<string> {
  const text = await Deno.readTextFile(`${ROOT}${name}`);
  return text
    .replaceAll("\\\n", " ")
    .replaceAll('"$AUDIT"', "/app/data/gateway-audit.json")
    .replace(/"\$BIND"/g, declaredBind(text));
}

function declaredBind(source: string): string {
  const match = /PORTICO_DEPLOY_BIND:-([0-9.]+)/.exec(source);
  assert(match, "the script must declare a default bind address");
  return match![1];
}

/** Reads the script without expanding variables. */
async function rawScript(name: string): Promise<string> {
  return await Deno.readTextFile(`${ROOT}${name}`);
}

function runFlags(source: string, entry: string): string[] {
  const pattern = new RegExp(`run\\s+((?:--\\S+\\s+)+)${entry.replaceAll("/", "\\/")}`);
  const match = pattern.exec(source);
  assert(match, `could not find the run invocation for ${entry}`);
  return match![1].trim().split(/\s+/);
}

for (const [name, contract] of Object.entries(CONTRACTS)) {
  Deno.test(`deploy contract: ${name} grants exactly what the code needs`, async () => {
    const bind = declaredBind(await rawScript(contract.file));
    const source = await script(contract.file);
    const flags = runFlags(source, contract.entry);

    // The whole point of the split: no deployed entrance may run with
    // everything open, and none may spawn processes.
    for (const banned of ["--allow-all", "-A", "--allow-run"]) {
      assert(
        !flags.includes(banned),
        `${contract.file} must not grant ${banned}; got ${flags.join(" ")}`,
      );
    }

    // Loopback plus the configured intranet address, and nothing else.
    assertEquals(flags.includes(netAllow(bind)), true);
    const net = flags.find((flag) => flag.startsWith("--allow-net"));
    assertEquals(net, netAllow(bind));
    // The read-only entrances must never be able to write.
    assert(
      flags.includes("--allow-read") || flags.some((flag) => flag.startsWith("--allow-read=")),
      `${contract.file} must grant read access`,
    );
    assert(flags.includes("--allow-env"), `${contract.file} must grant env access`);

    const write = flags.find((flag) => flag.startsWith("--allow-write"));
    if (contract.writable) {
      // Scoped to the audit file and its temp sibling — never the directory.
      assertEquals(
        write,
        "--allow-write=/app/data/gateway-audit.json,/app/data/gateway-audit.json.tmp",
      );
      assertEquals(gatewayPerms(bind).at(-1), netAllow(bind));
    } else {
      assertEquals(
        write,
        undefined,
        `${contract.file} is a read-only entrance and must not hold --allow-write`,
      );
      assertEquals(readOnlyHttpPerms(bind).some((flag) => flag.startsWith("--allow-write")), false);
    }
  });

  Deno.test(`deploy contract: ${name} points at the shipped entrypoint`, async () => {
    const source = await script(contract.file);
    assert(
      source.includes(contract.entry),
      `${contract.file} must run ${contract.entry}`,
    );
    assert(
      source.includes(`PORTICO_DEPLOY_PORT:-${contract.defaultPort}`),
      `${contract.file} must default to port ${contract.defaultPort}`,
    );
  });
}

Deno.test("deploy contract: every entrance is told where the Gateway audit lives", async () => {
  // Otherwise the Portal and MCP timelines silently omit Gateway access events
  // while `audit list --audit` includes them — the three entrances disagreeing
  // about the same question.
  for (const name of Object.keys(CONTRACTS)) {
    const source = await script(CONTRACTS[name].file);
    assert(
      source.includes("PORTICO_GATEWAY_AUDIT_PATH="),
      `${CONTRACTS[name].file} must pass PORTICO_GATEWAY_AUDIT_PATH`,
    );
  }
});
