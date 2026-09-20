import { assert, assertEquals } from "../assert.ts";
import { GATEWAY_PERMS, MCP_PERMS, PORTAL_PERMS } from "../../src/perms.ts";
import { ROOT } from "./harness.ts";
import { bootEntrypoint } from "./process.ts";

/**
 * The three-entrance deployment used to be proven by hand. `deploy/macos/verify.sh`
 * covers the macOS host; the Linux runbook ended at `systemctl enable --now`.
 *
 * That gap is not theoretical. A `systemctl restart` whose sudo prompt is
 * refused exits non-zero while the old containers keep serving: every port
 * still answers, so permission classes, health and even the product page look
 * untouched, and the previous revision keeps running until someone stops
 * believing the ports. Nothing in the repository could tell the difference
 * between "restarted onto the new revision" and "still the old process".
 *
 * `deploy/verify.sh` is that gate. It is read-only and loud: an error page
 * dressed as the product page, a fail-open `/internal`, an entrance that
 * executes tools, an unreachable port, a tree newer than the process serving
 * it, or a checkout that is not at the revision you pinned all fail it.
 */

const SCRIPT = `${ROOT}deploy/verify.sh`;
const PORTAL = `${ROOT}src/portal/main.ts`;
const GATEWAY = `${ROOT}src/gateway/main.ts`;
const MCP = `${ROOT}src/mcp/main.ts`;

/**
 * The gate's reported checks. Names are part of the contract: an operator
 * reading a failed deploy needs to know *which* promise broke.
 */
const CHECKS = [
  "entrance-address",
  "entrance-not-all-interfaces",
  "portal-product-page",
  "portal-review-entry",
  "portal-public-plane",
  "portal-internal-fail-closed",
  "portal-catalog-envelope",
  "portal-read-only",
  "gateway-does-not-execute-tools",
  "gateway-audit-is-auditor-only",
  "mcp-jsonrpc-initialize",
  "mcp-get-is-not-a-transport",
  "running-code-not-stale",
];

interface Run {
  code: number;
  stdout: string;
  stderr: string;
}

async function runVerify(env: Record<string, string>): Promise<Run> {
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

function portOf(url: string): string {
  return new URL(url).port;
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

async function headRevision(): Promise<string> {
  const output = await new Deno.Command("git", {
    args: ["-C", ROOT, "rev-parse", "HEAD"],
    stdout: "piped",
    stderr: "piped",
  }).output();
  const head = new TextDecoder().decode(output.stdout).trim();
  assert(output.code === 0 && head.length > 0, "the test tree must be a git checkout");
  return head;
}

/**
 * Stand-ins for the three entrances, so the failure paths below can flip one
 * behaviour at a time while everything else stays healthy — a gate that only
 * ever sees a wholly dead host cannot show *which* promise it enforces.
 *
 * The error page keeps the real product title on purpose: that is exactly what
 * the live Portal returns for a 404 (`<title>Portico · Portico</title>` plus
 * the shell), so a gate that only looks for the title accepts an error page.
 */
const PRODUCT_PAGE = '<!DOCTYPE html><html lang="zh-CN"><head>' +
  "<title>Portico · Portico</title></head><body>" +
  '<div class="frame home"><nav class="filter-tabs"></nav>' +
  '<section class="hero"><h1 class="hero-title">受控接入与安全治理</h1></section>' +
  "</div></body></html>";

const ERROR_PAGE = '<!DOCTYPE html><html lang="zh-CN"><head>' +
  "<title>Portico · Portico</title></head><body>" +
  '<div class="frame"><p class="empty">没有这个入口，或你无权看见。</p></div></body></html>';

/** The same product shell, plus the Review entry a deployment may advertise. */
function withReviewEntry(href: string): string {
  return PRODUCT_PAGE.replace(
    "</body>",
    `<a class="pub-nav__link" href="${href}">审核登录</a></body>`,
  );
}

interface StubOptions {
  /** Answer `/` with a 200 HTML page that is not the product shell. */
  errorPage?: boolean;
  /** Advertise this Review entry href in the product page chrome. */
  reviewHref?: string;
  /** Answer an anonymous `/internal` with 200 instead of 404. */
  failOpenInternal?: boolean;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

function htmlResponse(body: string, status = 200): Response {
  return new Response(body, {
    status,
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}

function portalStub(options: StubOptions): (request: Request) => Response {
  return (request) => {
    const { pathname } = new URL(request.url);
    // The real Portal rejects a non-GET before it routes, so the read-only gate
    // (POST /api/catalog => 405) must be answered here too. Serving the catalog
    // first would make this stub claim a writable Portal and fail the gate.
    if (request.method !== "GET") {
      return jsonResponse(
        { ok: false, error: { code: "USAGE", message: "method not allowed" } },
        405,
      );
    }
    if (pathname === "/api/catalog") return jsonResponse({ ok: true, data: [] });
    if (pathname === "/") {
      if (options.errorPage) return htmlResponse(ERROR_PAGE);
      return htmlResponse(options.reviewHref ? withReviewEntry(options.reviewHref) : PRODUCT_PAGE);
    }
    if (pathname === "/public") return htmlResponse(PRODUCT_PAGE);
    if (pathname === "/internal") {
      return options.failOpenInternal ? htmlResponse(PRODUCT_PAGE) : htmlResponse(ERROR_PAGE, 404);
    }
    return jsonResponse({ ok: false, error: { code: "NOT_FOUND", message: "not found" } }, 404);
  };
}

function gatewayStub(): (request: Request) => Response {
  return (request) => {
    const { pathname } = new URL(request.url);
    if (pathname.endsWith("/tools/call")) {
      return jsonResponse(
        { ok: false, error: { code: "USAGE", message: "gateway does not execute tools" } },
        405,
      );
    }
    if (pathname === "/gateway/audit") {
      return jsonResponse(
        { ok: false, error: { code: "FORBIDDEN", message: "forbidden" } },
        403,
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

interface Stubs {
  portal: string;
  gateway: string;
  mcp: string;
  stop: () => Promise<void>;
  stopMcp: () => void;
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
  if (!("hostname" in addr) || !("port" in addr)) {
    throw new Error("stub is not a TCP listener");
  }
  return { url: `http://${addr.hostname}:${addr.port}`, stop: () => controller.abort() };
}

function startStubs(options: StubOptions = {}): Stubs {
  const portal = listen(portalStub(options));
  const gateway = listen(gatewayStub());
  const mcp = listen(mcpStub());
  return {
    portal: portal.url,
    gateway: gateway.url,
    mcp: mcp.url,
    stop: () => {
      portal.stop();
      gateway.stop();
      mcp.stop();
      return Promise.resolve();
    },
    stopMcp: () => mcp.stop(),
  };
}

/**
 * The stubs stand in for a deployment, not for a checkout: there is no revision
 * for these runs to pin, so they accept a behaviour-only verdict explicitly
 * instead of tripping over a revision they never had. The gate still reports
 * `skip checkout-revision` for them, so nothing here passes while silently
 * pretending the revision was checked.
 */
function stubEnv(stubs: Stubs, extra: Record<string, string> = {}): Record<string, string> {
  return {
    PORTICO_DEPLOY_BIND: "127.0.0.1",
    PORTICO_DEPLOY_PORTAL_PORT: portOf(stubs.portal),
    PORTICO_DEPLOY_GATEWAY_PORT: portOf(stubs.gateway),
    PORTICO_DEPLOY_MCP_PORT: portOf(stubs.mcp),
    PORTICO_DEPLOY_ALLOW_UNPINNED: "1",
    ...extra,
  };
}

Deno.test("E2E: the deploy gate passes against the three shipped entrances", async () => {
  const dir = await Deno.makeTempDir({ prefix: "portico-verify-happy-" });
  const catalog = `${dir}/catalog.json`;
  const identities = `${dir}/identities.json`;
  const sessions = `${dir}/sessions.json`;
  const audit = `${dir}/gateway-audit.json`;
  const portal = await bootEntrypoint<{ url: string }>(PORTAL, {
    PORTICO_CATALOG_PATH: catalog,
    PORTICO_IDENTITIES_PATH: identities,
    PORTICO_SESSIONS_PATH: sessions,
    // What `deploy/run-portal.sh` passes: three entrances, no Review behind
    // the chrome, so the shipped deployment must gate green with no entry.
    PORTICO_REVIEW_ORIGIN: "off",
    PORTICO_PORT: "0",
  }, PORTAL_PERMS);
  const gateway = await bootEntrypoint<{ url: string }>(GATEWAY, {
    PORTICO_CATALOG_PATH: catalog,
    PORTICO_IDENTITIES_PATH: identities,
    PORTICO_SESSIONS_PATH: sessions,
    PORTICO_GATEWAY_AUDIT_PATH: audit,
    PORTICO_PORT: "0",
  }, GATEWAY_PERMS);
  const mcp = await bootEntrypoint<{ url: string }>(MCP, {
    PORTICO_CATALOG_PATH: catalog,
    PORTICO_IDENTITIES_PATH: identities,
    PORTICO_SESSIONS_PATH: sessions,
    PORTICO_PORT: "0",
  }, MCP_PERMS);

  try {
    const report = await runVerify({
      PORTICO_DEPLOY_BIND: "127.0.0.1",
      PORTICO_DEPLOY_PORTAL_PORT: portOf(portal.body.data.url),
      PORTICO_DEPLOY_GATEWAY_PORT: portOf(gateway.body.data.url),
      PORTICO_DEPLOY_MCP_PORT: portOf(mcp.body.data.url),
      PORTICO_EXPECT_SHA: await headRevision(),
    });

    for (const name of CHECKS) assertPassed(report, name);
    assertPassed(report, "checkout-revision");
    assertEquals(
      report.code,
      0,
      `a healthy deployment must exit 0; gate said:\n${report.stdout}${report.stderr}`,
    );
  } finally {
    await portal.stop();
    await gateway.stop();
    await mcp.stop();
  }
});

Deno.test("E2E: the deploy gate fails an entrance that stopped answering", async () => {
  const stubs = startStubs();
  try {
    // The port stays the same; the listener behind it goes away. A deploy that
    // silently kept a dead entrance must not pass.
    stubs.stopMcp();
    const report = await runVerify(stubEnv(stubs));
    assertFailed(report, "mcp-jsonrpc-initialize");
    assertFailed(report, "mcp-get-is-not-a-transport");
    assertEquals(report.code !== 0, true, "a dead entrance must exit non-zero");
    assertPassed(report, "portal-product-page");
    assertPassed(report, "gateway-does-not-execute-tools");
  } finally {
    await stubs.stop();
  }
});

Deno.test("E2E: the deploy gate refuses an error page dressed as the product page", async () => {
  const stubs = startStubs({ errorPage: true });
  try {
    const report = await runVerify(stubEnv(stubs));
    assertFailed(report, "portal-product-page");
    assertEquals(report.code !== 0, true, "an error page must exit non-zero");
  } finally {
    await stubs.stop();
  }
});

Deno.test("E2E: the deploy gate refuses a Review entrance this deployment does not serve", async () => {
  // Three entrances, no Review behind them: a `/review` link on the chromed
  // page is a dead governance path. (The stub defaults to origin `off`.)
  const stubs = startStubs({ reviewHref: "/review" });
  try {
    const report = await runVerify(stubEnv(stubs));
    assertFailed(report, "portal-review-entry");
    assertEquals(report.code !== 0, true, "an advertised dead entrance must exit non-zero");
    assertPassed(report, "portal-product-page");
  } finally {
    await stubs.stop();
  }
});

Deno.test("E2E: the deploy gate refuses an anonymous 200 on /internal", async () => {
  const stubs = startStubs({ failOpenInternal: true });
  try {
    const report = await runVerify(stubEnv(stubs));
    assertFailed(report, "portal-internal-fail-closed");
    assertEquals(report.code !== 0, true, "a fail-open internal plane must exit non-zero");
  } finally {
    await stubs.stop();
  }
});

Deno.test("E2E: the deploy gate refuses a process older than the tree it serves", async () => {
  // This is the silent no-op restart: the merge landed, the restart did not,
  // and the previous revision keeps answering on the same ports.
  const stubs = startStubs();
  const tree = await Deno.makeTempDir({ prefix: "portico-verify-tree-" });
  try {
    await Deno.mkdir(`${tree}/src`, { recursive: true });
    await Deno.writeTextFile(`${tree}/src/portal.ts`, "// the revision nobody restarted onto\n");
    await new Promise((resolve) => setTimeout(resolve, 1_100));

    const report = await runVerify(stubEnv(stubs, { PORTICO_DEPLOY_TREE: tree }));
    assertFailed(report, "running-code-not-stale");
    assertEquals(report.code !== 0, true, "stale code must exit non-zero");
    assertPassed(report, "portal-product-page");
  } finally {
    await stubs.stop();
  }
});

Deno.test("E2E: the deploy gate pins the checkout revision when asked", async () => {
  const stubs = startStubs();
  try {
    const pinned = await runVerify(stubEnv(stubs, { PORTICO_EXPECT_SHA: await headRevision() }));
    assertPassed(pinned, "checkout-revision");

    const wrong = await runVerify(stubEnv(stubs, {
      PORTICO_EXPECT_SHA: "0000000000000000000000000000000000000000",
    }));
    assertFailed(wrong, "checkout-revision");
    assertEquals(
      wrong.code !== 0,
      true,
      "a tree that is not at the pinned revision must exit non-zero",
    );

    // A run that never named a revision has not verified a deployment: the
    // probes can all be green because the process answering them is the one
    // the pull never replaced. It must fail loudly rather than exit 0 behind
    // a wall of green probes.
    const silent = await runVerify({ ...stubEnv(stubs), PORTICO_DEPLOY_ALLOW_UNPINNED: "" });
    assertFailed(silent, "checkout-revision");
    assertEquals(
      silent.code !== 0,
      true,
      "a run that never named a revision must not exit clean",
    );

    // A non-empty value is not an acceptance: the runtime's own flag reader
    // takes only an explicit yes, so `PORTICO_DEPLOY_ALLOW_UNPINNED=0` must not
    // open the hatch either.
    const zeroed = await runVerify({ ...stubEnv(stubs), PORTICO_DEPLOY_ALLOW_UNPINNED: "0" });
    assertFailed(zeroed, "checkout-revision");
    assertEquals(
      zeroed.code !== 0,
      true,
      "a flag that is not an explicit yes must not accept an unpinned run",
    );

    // Accepting the gap explicitly keeps ad-hoc probing possible, and the gate
    // still records what it did not check instead of going quiet about it.
    const accepted = await runVerify(stubEnv(stubs));
    assertEquals(outcome(accepted, "checkout-revision"), "skip");
    assertEquals(
      accepted.code,
      0,
      `a behaviour-only run must still prove behaviour:\n${accepted.stdout}${accepted.stderr}`,
    );
  } finally {
    await stubs.stop();
  }
});

/**
 * The address an entrance serves on is a property of the deployment, not
 * something the gate may assume. The shipped runbook injects an interface
 * address (systemd drop-in / `EnvironmentFile`), so a deployment can be
 * perfectly healthy on an address the gate never guessed; probing the loopback
 * default then reports ten broken promises about a deployment that is fine —
 * the same false confidence this gate exists to remove, pointing the other way.
 * A port number is also too coarse to say *which* process was measured: a
 * leftover entrance next to the real one leaves the gate guessing.
 */

/** A listener table the gate reads instead of the host's own. */
async function fakeListenerTable(
  rows: string[],
): Promise<{ env: Record<string, string>; stop: () => Promise<void> }> {
  const dir = await Deno.makeTempDir({ prefix: "portico-verify-listeners-" });
  // Linux is read through `ss`; the gate only falls back to `lsof` without it,
  // so shadowing one is enough to hand the gate a table of our choosing.
  await Deno.writeTextFile(`${dir}/ss`, `#!/bin/sh\ncat <<'TABLE'\n${rows.join("\n")}\nTABLE\n`);
  await Deno.chmod(`${dir}/ss`, 0o755);
  return {
    env: { PATH: `${dir}:${Deno.env.get("PATH") ?? ""}` },
    stop: () => Deno.remove(dir, { recursive: true }),
  };
}

/** One `ss -ltn` row: state, queues, local address:port, peer address:port. */
function listenRow(address: string, port: string): string {
  return `LISTEN 0 128 ${address}:${port} 0.0.0.0:*`;
}

function verdictOf(report: Run, name: string): string {
  return report.stdout.split("\n").find((line) => line.includes(name)) ?? "";
}

Deno.test("E2E: the deploy gate verifies the address the entrances actually serve", async () => {
  const stubs = startStubs();
  // A host whose listener table names its entrance instead of numbering it is
  // still a host the gate must verify: with nothing declared, it takes the
  // address from the table rather than from its own default. The name resolves
  // to the loopback stub either way, so only probing the table's value keeps
  // every promise green.
  const table = await fakeListenerTable([
    listenRow("localhost", portOf(stubs.portal)),
    listenRow("localhost", portOf(stubs.gateway)),
    listenRow("localhost", portOf(stubs.mcp)),
  ]);
  try {
    const report = await runVerify({
      ...stubEnv(stubs),
      PORTICO_DEPLOY_BIND: "",
      ...table.env,
    });
    assertPassed(report, "entrance-address");
    for (const name of CHECKS) {
      // The staleness check reads the same table, which describes no process of
      // its own; it is asserted against real listeners in its own test.
      if (name === "running-code-not-stale") continue;
      assertPassed(report, name);
    }
    assert(
      report.stdout.includes("localhost"),
      `the gate must probe the address it discovered:\n${report.stdout}`,
    );
    assertEquals(
      report.code,
      0,
      `a healthy deployment must exit 0 on a discovered address:\n${report.stdout}${report.stderr}`,
    );
  } finally {
    await table.stop();
    await stubs.stop();
  }
});

Deno.test("E2E: the deploy gate names the address that is actually serving", async () => {
  const stubs = startStubs();
  try {
    // The trap this closes: the entrances answer on 127.0.0.1, the gate was
    // pointed at an address nothing serves, and ten "got HTTP 000, want 200"
    // lines read like ten broken promises instead of one wrong address.
    const report = await runVerify(stubEnv(stubs, { PORTICO_DEPLOY_BIND: "127.0.0.9" }));
    assertFailed(report, "entrance-address");
    const verdict = verdictOf(report, "entrance-address");
    assert(
      verdict.includes("127.0.0.9"),
      `the gate must name the address it was pointed at:\n${report.stdout}`,
    );
    assert(
      verdict.includes("127.0.0.1"),
      `the gate must name the address that answers:\n${report.stdout}`,
    );
    assertFailed(report, "portal-product-page");
    assertEquals(report.code !== 0, true, "an address nothing serves must exit non-zero");
  } finally {
    await stubs.stop();
  }
});

Deno.test("E2E: the deploy gate says which port is empty when nothing answers", async () => {
  const stubs = startStubs();
  const ports = stubEnv(stubs);
  const portalPort = portOf(stubs.portal);
  await stubs.stop();
  try {
    // Every port is empty and nothing was declared: the gate must name the port
    // it looked at instead of reporting a wrong status code ten times.
    const report = await runVerify({ ...ports, PORTICO_DEPLOY_BIND: "" });
    assertFailed(report, "entrance-address");
    const verdict = verdictOf(report, "entrance-address");
    assert(
      verdict.includes(portalPort),
      `the gate must name the port nobody answers on:\n${report.stdout}`,
    );
    assert(
      verdict.includes("nothing is listening"),
      `the gate must say the port is empty:\n${report.stdout}`,
    );
    assertFailed(report, "portal-product-page");
    assertEquals(report.code !== 0, true, "empty ports must exit non-zero");
  } finally {
    await stubs.stop();
  }
});

Deno.test("E2E: the deploy gate refuses a port two listeners answer on", async () => {
  const stubs = startStubs();
  const table = await fakeListenerTable([
    listenRow("127.0.0.1", portOf(stubs.portal)),
    listenRow("127.0.0.2", portOf(stubs.portal)),
    listenRow("127.0.0.1", portOf(stubs.gateway)),
    listenRow("127.0.0.1", portOf(stubs.mcp)),
  ]);
  try {
    // A leftover entrance next to the real one: the port alone cannot say which
    // process the gate measured, so it must refuse to pick one.
    const report = await runVerify({
      ...stubEnv(stubs),
      PORTICO_DEPLOY_BIND: "",
      ...table.env,
    });
    assertFailed(report, "entrance-address");
    assert(
      verdictOf(report, "entrance-address").includes("127.0.0.2"),
      `the gate must name both listeners:\n${report.stdout}`,
    );
    assertEquals(report.code !== 0, true, "an ambiguous port must exit non-zero");

    // Declaring one of the two does not make the other one go away: a leftover
    // entrance on the same port is still a process this deployment serves.
    const declared = await runVerify({
      ...stubEnv(stubs, { PORTICO_DEPLOY_BIND: "127.0.0.1" }),
      ...table.env,
    });
    assertFailed(declared, "entrance-address");
    assert(
      verdictOf(declared, "entrance-address").includes("127.0.0.2"),
      `the gate must still name the second listener:\n${declared.stdout}`,
    );
  } finally {
    await table.stop();
    await stubs.stop();
  }
});

Deno.test("E2E: the deploy gate refuses an entrance bound to all interfaces", async () => {
  const stubs = startStubs();
  const table = await fakeListenerTable([
    listenRow("0.0.0.0", portOf(stubs.portal)),
    listenRow("127.0.0.1", portOf(stubs.gateway)),
    listenRow("127.0.0.1", portOf(stubs.mcp)),
  ]);
  try {
    // The scripts may not say `0.0.0.0`, but the running entrance is the thing
    // that answers on every interface, and only the host can show that.
    const report = await runVerify({ ...stubEnv(stubs), PORTICO_DEPLOY_BIND: "", ...table.env });
    assertFailed(report, "entrance-not-all-interfaces");
    assert(
      verdictOf(report, "entrance-not-all-interfaces").includes(portOf(stubs.portal)),
      `the gate must name the exposed port:\n${report.stdout}`,
    );
    // The entrances still answer: one broken promise, not ten.
    assertPassed(report, "portal-product-page");
    assertEquals(report.code !== 0, true, "an all-interface entrance must exit non-zero");
  } finally {
    await table.stop();
    await stubs.stop();
  }
});
