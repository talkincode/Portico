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
  "running-code-not-stale",
  "portal-local",
  "review-local",
  "portal-public",
  "review-public",
  "catalog-envelope",
  "internal-anon-404",
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

function outcome(report: Run, name: string): "ok" | "FAIL" | "absent" {
  const line = report.stdout.split("\n").find((candidate) => candidate.includes(name));
  if (!line) return "absent";
  return line.trimStart().startsWith("FAIL ") ? "FAIL" : "ok";
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

/**
 * A healthy deployment: four entrances listening and one public origin, with a
 * checkout whose sources are older than the processes serving them.
 */
async function startDeployment(
  options: { staleSources?: boolean; gatewayExecutesTools?: boolean } = {},
): Promise<Deployment> {
  const tree = await Deno.makeTempDir({ prefix: "portico-macos-tree-" });
  await Deno.mkdir(`${tree}/src`, { recursive: true });
  const source = `${tree}/src/portal.ts`;
  await Deno.writeTextFile(source, "// the revision the daemons were started from\n");
  if (!options.staleSources) {
    // Older than every process in this test run, which is what a restart onto
    // the pulled revision looks like from the outside.
    const longAgo = new Date(Date.now() - 3_600_000);
    await Deno.utime(source, longAgo, longAgo);
  }

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
    },
    stopGateway: () => gateway.stop(),
    stop: () => {
      portal.stop();
      review.stop();
      gateway.stop();
      mcp.stop();
      edge.stop();
      return Deno.remove(tree, { recursive: true });
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
