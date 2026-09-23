import { assert, assertEquals } from "../assert.ts";
import { ROOT } from "./harness.ts";

/**
 * The macOS gate (`deploy/macos/verify.sh`) is what the production runbook
 * ends on, and until now it only proved that four ports answer. Two claims
 * stayed outside it:
 *
 * 1. *Which process* answers. `launchctl kickstart -k` is the step that ships
 *    a pull, and a pull whose restart never happened leaves the previous
 *    revision serving the same ports with the same product page: the gate went
 *    green while production ran code from before the deploy.
 * 2. *Which entrances* answer. The gate probed Portal and Review; the Gateway
 *    and MCP ports were never asked to prove their contract at all.
 *
 * The gate therefore resolves each of the four entrances to a process and
 * compares that process's start time against the tree it serves, and it asks
 * the Gateway and MCP the same two questions the Linux gate asks them. Both
 * dimensions are tested here against real listeners, because a gate that can
 * only be verified against the host it runs on is a gate nobody can test.
 */

const SCRIPT = `${ROOT}deploy/macos/verify.sh`;

/** Every verdict the gate must report, by name. */
const CHECKS = [
  "running-revision",
  "running-code-not-stale",
  "portal-local",
  "review-local",
  "portal-public",
  "review-public",
  "catalog-envelope",
  "internal-anon-fail-closed",
  "gateway-does-not-execute-tools",
  "mcp-jsonrpc-initialize",
];

interface Run {
  code: number;
  stdout: string;
  stderr: string;
}

async function runGate(env: Record<string, string>): Promise<Run> {
  const output = await new Deno.Command("bash", {
    args: [SCRIPT],
    cwd: ROOT,
    env: { ...Deno.env.toObject(), ...env },
    stdout: "piped",
    stderr: "piped",
  }).output();
  return {
    code: output.code,
    stdout: new TextDecoder().decode(output.stdout),
    stderr: new TextDecoder().decode(output.stderr),
  };
}

function outcome(report: Run, name: string): "ok" | "FAIL" | "skip" | "absent" {
  const line = report.stdout.split("\n").find((candidate) => candidate.includes(name));
  if (!line) return "absent";
  for (const verdict of ["ok", "FAIL", "skip"] as const) {
    if (line.trimStart().startsWith(`${verdict} `) && line.includes(name)) return verdict;
  }
  return "absent";
}

function assertPassed(report: Run, name: string): void {
  assertEquals(
    outcome(report, name),
    "ok",
    `expected '${name}' to pass; gate exited ${report.code} and said:\n${report.stdout}${report.stderr}`,
  );
}

function assertFailed(report: Run, name: string): void {
  assertEquals(
    outcome(report, name),
    "FAIL",
    `expected '${name}' to fail; gate exited ${report.code} and said:\n${report.stdout}${report.stderr}`,
  );
}

function verdictOf(report: Run, name: string): string {
  return report.stdout.split("\n").find((line) => line.includes(name)) ?? "";
}

/**
 * Stand-ins for the four entrances plus the public origin, so each failure
 * path can flip one thing while everything else stays healthy — a gate that
 * only ever sees a dead host cannot show *which* promise it enforces.
 *
 * The public origin is the same shape production serves through the tunnel:
 * one hostname where `/review*` reaches Review and everything else reaches the
 * Portal, so a single stub answers both public probes.
 */
const PRODUCT_PAGE = '<!DOCTYPE html><html lang="zh-CN"><head>' +
  "<title>Portico · Portico</title></head><body>" +
  '<div class="frame home"><nav class="filter-tabs"></nav></div></body></html>';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

function edgeStub(): (request: Request) => Response {
  return (request) => {
    const { pathname } = new URL(request.url);
    if (pathname === "/public" || pathname === "/") {
      return new Response(PRODUCT_PAGE, {
        headers: { "content-type": "text/html; charset=utf-8" },
      });
    }
    if (pathname === "/review/login") {
      return new Response(PRODUCT_PAGE, {
        headers: { "content-type": "text/html; charset=utf-8" },
      });
    }
    if (pathname === "/api/catalog") return jsonResponse({ ok: true, data: [] });
    // The live Portal answers an unreachable path with its own 404 envelope;
    // the anonymous internal plane must stay a 404 here too.
    return jsonResponse({ ok: false, error: { code: "NOT_FOUND", message: "not found" } }, 404);
  };
}

function gatewayStub(executesTools = false): (request: Request) => Response {
  return (request) => {
    const { pathname } = new URL(request.url);
    if (pathname.endsWith("/tools/call")) {
      if (executesTools) return jsonResponse({ ok: true, data: { executed: true } });
      return jsonResponse(
        { ok: false, error: { code: "USAGE", message: "gateway does not execute tools" } },
        405,
      );
    }
    return jsonResponse({ ok: false, error: { code: "NOT_FOUND", message: "not found" } }, 404);
  };
}

function mcpStub(): (request: Request) => Response {
  return (request) => {
    if (request.method !== "POST") {
      return jsonResponse({
        jsonrpc: "2.0",
        id: null,
        error: { code: -32600, message: "the MCP entrance accepts JSON-RPC over POST" },
      }, 405);
    }
    return jsonResponse({
      jsonrpc: "2.0",
      id: 1,
      result: { serverInfo: { name: "portico" } },
    });
  };
}

const controllers: AbortController[] = [];

function listen(handler: (request: Request) => Response): { url: string; stop: () => void } {
  const controller = new AbortController();
  controllers.push(controller);
  const server = Deno.serve({
    hostname: "127.0.0.1",
    port: 0,
    signal: controller.signal,
    onListen: () => {},
  }, handler);
  const addr = server.addr;
  if (!("hostname" in addr) || !("port" in addr)) throw new Error("stub is not a TCP listener");
  return { url: `http://${addr.hostname}:${addr.port}`, stop: () => controller.abort() };
}

function portOf(url: string): string {
  return new URL(url).port;
}

interface Deployment {
  env: Record<string, string>;
  tree: string;
  stopGateway: () => void;
  stop: () => Promise<void>;
}

/** What a launcher recorded for the processes it started. */
interface Launch {
  /** The revision it recorded; `null` stands for a launcher that records none. */
  revision: string | null;
  /** Anything else it exported. The gate must never repeat it. */
  extra?: Record<string, string>;
}

async function git(args: string[]): Promise<string> {
  const output = await new Deno.Command("git", {
    args,
    stdout: "piped",
    stderr: "piped",
  }).output();
  const stdout = new TextDecoder().decode(output.stdout).trim();
  assert(
    output.code === 0,
    `git ${args.join(" ")} failed: ${new TextDecoder().decode(output.stderr)}`,
  );
  return stdout;
}

/** The tree the daemons were started from, as the gate sees it: a checkout. */
async function checkoutTree(): Promise<string> {
  const tree = await Deno.makeTempDir({ prefix: "portico-macos-tree-" });
  await Deno.mkdir(`${tree}/src`, { recursive: true });
  await Deno.writeTextFile(
    `${tree}/src/portal.ts`,
    "// the revision the daemons were started from\n",
  );
  await git(["-C", tree, "init", "--quiet"]);
  await git(["-C", tree, "add", "-A"]);
  await git([
    "-C",
    tree,
    "-c",
    "user.email=portico@example.invalid",
    "-c",
    "user.name=portico",
    "commit",
    "--quiet",
    "-m",
    "the revision the daemons were started from",
  ]);
  return tree;
}

async function treeRevision(tree: string): Promise<string> {
  return await git(["-C", tree, "rev-parse", "HEAD"]);
}

/**
 * The launch environment of the serving processes. `ps eww` is where the kernel
 * keeps what a process was *started* with, so a fake here is a fake launcher:
 * the gate is handed an environment of our choosing while every other question
 * it asks (the start time behind `running-code-not-stale`, the listener table)
 * still goes to the real host.
 */
async function fakeLaunchEnvironment(
  launch: Launch,
): Promise<{ env: Record<string, string>; stop: () => Promise<void> }> {
  const dir = await Deno.makeTempDir({ prefix: "portico-macos-launch-" });
  const recorded = launch.revision === null ? [] : [`PORTICO_REVISION=${launch.revision}`];
  const extra = Object.entries(launch.extra ?? {}).map(([key, value]) => `${key}=${value}`);
  const line = ["1", "?", "00:00:00", "deno", ...recorded, ...extra].join(" ");
  await Deno.writeTextFile(
    `${dir}/ps`,
    `#!/bin/sh\n` +
      `# Only the launch environment is synthetic; everything else is the host's.\n` +
      `if [ "$1" = "eww" ]; then\n  printf '%s\\n' '${line}'\n  exit 0\nfi\n` +
      `exec /bin/ps "$@"\n`,
  );
  await Deno.chmod(`${dir}/ps`, 0o755);
  return {
    env: { PATH: `${dir}:${Deno.env.get("PATH") ?? ""}` },
    stop: () => Deno.remove(dir, { recursive: true }),
  };
}

/**
 * A healthy deployment: four entrances listening and one public origin, with a
 * checkout whose sources are older than the processes serving them and whose
 * launcher recorded the revision it started them from.
 */
async function startDeployment(
  options: {
    staleSources?: boolean;
    gatewayExecutesTools?: boolean;
    /** Recorded revision; defaults to the tree's own, which is the healthy case. */
    launchRevision?: string | null;
    extraLaunchEnv?: Record<string, string>;
  } = {},
): Promise<Deployment> {
  const tree = await checkoutTree();
  const source = `${tree}/src/portal.ts`;
  if (!options.staleSources) {
    // Older than every process in this test run, which is what a restart onto
    // the pulled revision looks like from the outside.
    const longAgo = new Date(Date.now() - 3_600_000);
    await Deno.utime(source, longAgo, longAgo);
  }
  const launch = await fakeLaunchEnvironment({
    revision: options.launchRevision === undefined
      ? await treeRevision(tree)
      : options.launchRevision,
    extra: options.extraLaunchEnv,
  });

  const edge = listen(edgeStub());
  const portal = listen(edgeStub());
  const review = listen(edgeStub());
  const gateway = listen(gatewayStub(options.gatewayExecutesTools ?? false));
  const mcp = listen(mcpStub());

  return {
    tree,
    env: {
      PORTICO_DEPLOY_BIND: "127.0.0.1",
      PORTICO_DEPLOY_PORTAL_PORT: portOf(portal.url),
      PORTICO_DEPLOY_GATEWAY_PORT: portOf(gateway.url),
      PORTICO_DEPLOY_MCP_PORT: portOf(mcp.url),
      PORTICO_DEPLOY_REVIEW_PORT: portOf(review.url),
      PORTICO_DEPLOY_PUBLIC_ORIGIN: edge.url,
      PORTICO_DEPLOY_TREE: tree,
      PATH: launch.env.PATH,
      // The tree here is a stand-in, not the production checkout, so there is
      // no revision to *pin*: the run accepts a behaviour-only verdict
      // explicitly. The gate still reports `skip checkout-revision`, so it
      // never passes silently as if the revision had been checked.
      PORTICO_DEPLOY_ALLOW_UNPINNED: "1",
    },
    stopGateway: () => gateway.stop(),
    stop: () => {
      portal.stop();
      review.stop();
      gateway.stop();
      mcp.stop();
      edge.stop();
      return Promise.all([
        Deno.remove(tree, { recursive: true }),
        launch.stop(),
      ]).then(() => {});
    },
  };
}

Deno.test("E2E: the macOS gate passes against the four shipped entrances", async () => {
  const deployment = await startDeployment();
  try {
    const report = await runGate(deployment.env);
    for (const name of CHECKS) assertPassed(report, name);
    assertEquals(
      report.code,
      0,
      `a healthy deployment must exit 0:\n${report.stdout}${report.stderr}`,
    );
  } finally {
    await deployment.stop();
  }
});

Deno.test("E2E: the macOS gate refuses a daemon older than the tree it serves", async () => {
  // The silent no-op restart: the pull landed, the kickstart did not, and the
  // previous revision keeps answering every probe with the same product page.
  const deployment = await startDeployment({ staleSources: true });
  try {
    const report = await runGate(deployment.env);
    assertFailed(report, "running-code-not-stale");
    assertPassed(report, "portal-local");
    assert(
      verdictOf(report, "running-code-not-stale").includes("portal.ts"),
      `the gate must name the source the process predates:\n${report.stdout}`,
    );
    assertEquals(report.code !== 0, true, "stale daemons must exit non-zero");
  } finally {
    await deployment.stop();
  }
});

Deno.test("E2E: the macOS gate refuses an entrance with no process behind it", async () => {
  // Four entrances are the shape this deployment ships; three of them
  // answering is not a partly healthy host, it is an unverified one.
  const deployment = await startDeployment();
  const gatewayPort = deployment.env.PORTICO_DEPLOY_GATEWAY_PORT;
  deployment.stopGateway();
  try {
    const report = await runGate(deployment.env);
    assertFailed(report, "running-code-not-stale");
    assert(
      verdictOf(report, "running-code-not-stale").includes(gatewayPort),
      `the gate must name the entrance nobody serves:\n${report.stdout}`,
    );
    assertPassed(report, "portal-local");
  } finally {
    await deployment.stop();
  }
});

Deno.test("E2E: the macOS gate refuses a Gateway that executes tools", async () => {
  const deployment = await startDeployment({ gatewayExecutesTools: true });
  try {
    const report = await runGate(deployment.env);
    assertFailed(report, "gateway-does-not-execute-tools");
    assertEquals(report.code !== 0, true, "a Gateway that executes tools must exit non-zero");
  } finally {
    await deployment.stop();
  }
});

Deno.test("E2E: the macOS gate refuses a daemon started from the revision the tree left behind", async () => {
  // The pull landed and the restart did not: every entrance answers, the
  // product page is identical, and the only thing that changed is which
  // revision the serving processes were started from. File times can be
  // rewritten by a restore that preserves them; the launch environment is fixed
  // when the process starts, so this is the one claim that a pull-then-no-restart
  // cannot retcon — and the tree's own revision is what it has to match.
  const deployment = await startDeployment({ launchRevision: "0".repeat(40) });
  const treeSha = await treeRevision(deployment.tree);
  try {
    const report = await runGate(deployment.env);
    assertFailed(report, "running-revision");
    assertPassed(report, "portal-local");
    assert(
      verdictOf(report, "running-revision").includes("restart"),
      `the gate must say what to do about it:\n${report.stdout}`,
    );
    assert(
      report.stdout.includes("0".repeat(40)) && report.stdout.includes(treeSha),
      `the gate must name both revisions:\n${report.stdout}`,
    );
    assertEquals(report.code !== 0, true, "an un-restarted daemon must exit non-zero");
  } finally {
    await deployment.stop();
  }
});

Deno.test("E2E: the macOS gate refuses a launcher that recorded no revision", async () => {
  // A run script that never records what it launched leaves the claim
  // unprovable, and an unprovable claim is not a passing one: the gate has to
  // fail the entrance rather than accept a host where nobody can say which
  // revision the daemons are running.
  const deployment = await startDeployment({ launchRevision: null });
  try {
    const report = await runGate(deployment.env);
    assertFailed(report, "running-revision");
    assertPassed(report, "portal-local");
    assert(
      report.stdout.includes("PORTICO_REVISION"),
      `the gate must name what the launcher was supposed to record:\n${report.stdout}`,
    );
    assertEquals(report.code !== 0, true, "an unrecorded launch must exit non-zero");
  } finally {
    await deployment.stop();
  }
});

Deno.test("E2E: the macOS gate never echoes the launch environment it reads", async () => {
  // Reading a running process's environment means reading whatever else the
  // launcher exported, and a gate that printed that would turn a read-only
  // check into a disclosure of every secret in the deployment's env file. Only
  // the one variable it asks about may reach the output.
  const sentinel = "sentinel-value-that-must-not-be-printed";
  const deployment = await startDeployment({
    extraLaunchEnv: { PORTICO_TEST_SENTINEL: sentinel },
  });
  try {
    const report = await runGate(deployment.env);
    assertPassed(report, "running-revision");
    assert(
      !report.stdout.includes(sentinel) && !report.stderr.includes(sentinel),
      `the gate must not repeat the environment it read:\n${report.stdout}${report.stderr}`,
    );
  } finally {
    await deployment.stop();
  }
});

Deno.test("E2E: the macOS gate pins the checkout revision when asked", async () => {
  const deployment = await startDeployment();
  try {
    const wrong = await runGate({
      ...deployment.env,
      PORTICO_EXPECT_SHA: "0000000000000000000000000000000000000000",
    });
    assertFailed(wrong, "checkout-revision");
    assertEquals(wrong.code !== 0, true, "a tree that is not at the pinned revision must fail");
  } finally {
    await deployment.stop();
  }
});

Deno.test("E2E: the macOS gate refuses a run that never named a revision", async () => {
  const deployment = await startDeployment();
  try {
    // Every entrance answers and every behaviour probe is green, and that is
    // exactly the trap: `launchctl kickstart -k` is what ships a pull, so a
    // restart that never happened leaves the previous revision answering all of
    // them. A run that never named a revision has verified no deployment and
    // must not exit 0 as one — and a flag that is not an explicit yes is not an
    // acceptance, so `0` is in that same set.
    for (const flag of ["", "0"]) {
      const report = await runGate({ ...deployment.env, PORTICO_DEPLOY_ALLOW_UNPINNED: flag });
      assertFailed(report, "checkout-revision");
      assertPassed(report, "portal-local");
      assertEquals(
        report.code !== 0,
        true,
        `an unpinned run (flag ${JSON.stringify(flag)}) must not exit clean`,
      );
    }
  } finally {
    await deployment.stop();
  }
});

Deno.test("E2E: the macOS gate records an accepted unpinned run as a skip", async () => {
  const deployment = await startDeployment();
  try {
    // `PORTICO_DEPLOY_ALLOW_UNPINNED` is in `deployment.env` here. Accepting the
    // gap keeps a behaviour-only run possible; going quiet about it would not,
    // so the verdict is a `skip` that names what was left unchecked.
    const report = await runGate(deployment.env);
    assertEquals(outcome(report, "checkout-revision"), "skip");
    assert(
      verdictOf(report, "checkout-revision").includes("PORTICO_EXPECT_SHA"),
      `the skip must name the variable that was not set, gate said:\n${report.stdout}`,
    );
    assertEquals(
      report.code,
      0,
      `an accepted unpinned run must still prove behaviour:\n${report.stdout}${report.stderr}`,
    );
  } finally {
    await deployment.stop();
  }
});
