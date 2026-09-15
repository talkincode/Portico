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
    assertEquals(bind, "127.0.0.1");
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

    // Loopback is always granted. A distinct RFC1918 bind is added next to it.
    // The scripts expand `"$BIND"` even when the default is loopback, so the
    // allow-list may repeat 127.0.0.1 rather than collapsing to netAllow().
    const net = flags.find((flag) => flag.startsWith("--allow-net"));
    assertEquals(net?.startsWith("--allow-net=127.0.0.1"), true);
    assertEquals(net?.includes("0.0.0.0"), false);
    if (bind === "127.0.0.1" || bind === "localhost") {
      assertEquals(net === netAllow(bind) || net === `--allow-net=127.0.0.1,${bind}`, true);
    } else {
      assertEquals(net, netAllow(bind));
    }
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

/**
 * systemd units are part of the same contract as the run scripts. The live
 * host used to start Portal/Gateway from an unversioned extra checkout and
 * leave MCP as a detached `unless-stopped` container, so
 * `systemctl restart portico-*` could not restart all three.
 */
interface UnitContract {
  file: string;
  script: string;
  container: string;
  port: number;
}

const UNITS: Record<string, UnitContract> = {
  portal: {
    file: "deploy/portico-portal.service",
    script: "deploy/run-portal.sh",
    container: "portico-portal",
    port: 8788,
  },
  gateway: {
    file: "deploy/portico-gateway.service",
    script: "deploy/run-gateway.sh",
    container: "portico-gateway",
    port: 8789,
  },
  mcp: {
    file: "deploy/portico-mcp.service",
    script: "deploy/run-mcp.sh",
    container: "portico-mcp",
    port: 8790,
  },
};

for (const [name, unit] of Object.entries(UNITS)) {
  Deno.test(`deploy contract: ${name} systemd unit starts the versioned script`, async () => {
    const text = await Deno.readTextFile(`${ROOT}${unit.file}`);
    const start = /ExecStart=(\S+)/.exec(text)?.[1];
    const wd = /WorkingDirectory=(\S+)/.exec(text)?.[1];
    assert(start, `${unit.file} must declare ExecStart`);
    assert(wd, `${unit.file} must declare WorkingDirectory`);
    assert(
      !start!.includes("portico-runtime") && !wd!.includes("portico-runtime"),
      `${unit.file} must ExecStart the versioned checkout script, not an unreviewed extra copy`,
    );
    assert(
      !text.includes("0.0.0.0"),
      `${unit.file} must not bind all interfaces`,
    );
    assert(
      text.includes("intranet test, not production"),
      `${unit.file} must say this is intranet test, not production`,
    );
    assert(text.includes("After=docker.service"), `${unit.file} must start after docker`);
    assert(text.includes("Restart=on-failure"), `${unit.file} must restart on failure`);
    assert(text.includes("User=master"), `${unit.file} must run as master`);
    assert(
      text.includes(`ExecStartPre=-/usr/bin/docker rm -f ${unit.container}`),
      `${unit.file} must clear a leftover ${unit.container} container`,
    );
    assert(
      text.includes(`ExecStop=/usr/bin/docker stop ${unit.container}`),
      `${unit.file} must stop ${unit.container} on unit stop`,
    );
    assert(
      text.includes("Environment=PORTICO_DEPLOY_BIND=127.0.0.1"),
      `${unit.file} must default the bind address to loopback; the real intranet address is injected at install time`,
    );
    assert(
      !/\b(?:10\.\d{1,3}\.\d{1,3}\.\d{1,3}|172\.(?:1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}|192\.168\.\d{1,3}\.\d{1,3})\b/
        .test(text),
      `${unit.file} must not embed an RFC1918 address`,
    );
    assert(
      !text.includes("/home/"),
      `${unit.file} must use the example checkout path, not a host home directory`,
    );
    assert(
      text.includes(`Environment=PORTICO_DEPLOY_PORT=${unit.port}`),
      `${unit.file} must pin port ${unit.port}`,
    );

    assert(
      start!.endsWith(`/${unit.script}`),
      `${unit.file} ExecStart must be the versioned ${unit.script}`,
    );
    assertEquals(
      start,
      `${wd}/${unit.script}`,
      `${unit.file} ExecStart must live under WorkingDirectory`,
    );
  });
}

Deno.test("deploy contract: drop-in example keeps live bind out of the repo", async () => {
  const text = await Deno.readTextFile(`${ROOT}deploy/drop-in.example.conf`);
  assert(
    text.includes("[Service]"),
    "the drop-in example must be a systemd service override",
  );
  assert(
    text.includes("WorkingDirectory=/opt/portico"),
    "the drop-in example must use the same example checkout path as the unit templates",
  );
  assert(
    text.includes("Environment=PORTICO_DEPLOY_BIND=127.0.0.1"),
    "the drop-in example must default the bind address to loopback",
  );
  assert(
    /^ExecStart=$/m.test(text),
    "the drop-in example must clear ExecStart before resetting it",
  );
  assert(
    text.includes("ExecStart=/opt/portico/deploy/run-portal.sh"),
    "the drop-in example must show how to point ExecStart at the versioned script",
  );
  assert(
    !text.includes("0.0.0.0"),
    "the drop-in example must not bind all interfaces",
  );
  assert(
    !/\b(?:10\.\d{1,3}\.\d{1,3}\.\d{1,3}|172\.(?:1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}|192\.168\.\d{1,3}\.\d{1,3})\b/
      .test(text),
    "the drop-in example must not embed an RFC1918 address",
  );
  assert(
    !text.includes("/home/"),
    "the drop-in example must not use a host home directory",
  );
});
