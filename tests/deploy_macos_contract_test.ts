import { assert, assertEquals } from "./assert.ts";
import { cfAccessNetHost, githubNetHosts, portalPerms, reviewPerms } from "../src/perms.ts";

/**
 * macOS (LaunchDaemon) deployment contract. The Linux docker/systemd scripts
 * in deploy/*.sh are pinned by tests/deploy_contract_test.ts; the macstudio
 * host runs Deno natively under launchd instead, so the same classes of
 * promises are pinned here against the templates in deploy/macos/:
 * supervisor-only permissions, no baked-in host addresses or users, token
 * never in the repo, daemons that cannot go half-dead.
 */

const ROOT = new URL("../", import.meta.url).pathname;

async function text(name: string): Promise<string> {
  return await Deno.readTextFile(`${ROOT}${name}`);
}

Deno.test("deploy macos: supervisor holds only spawn rights", async () => {
  const source = (await text("deploy/macos/run.sh")).replaceAll("\\\n", " ");
  const match = /run\s+((?:--\S+\s+)+)src\/up\/main\.ts/.exec(source);
  assert(match, "deploy/macos/run.sh must exec the up supervisor");
  const flags = match![1].trim().split(/\s+/);
  assertEquals(flags, ["--allow-env", "--allow-run"]);
  for (const banned of ["--allow-all", "-A", "--allow-write", "--allow-net"]) {
    assert(!flags.includes(banned), `supervisor must not hold ${banned}`);
  }
});

Deno.test("deploy macos: review scoped perms cover both tmp siblings for read and write", () => {
  const flags = reviewPerms("127.0.0.1", {
    catalog: "/app/data/catalog.json",
    identities: "/app/data/identities.json",
    sessions: "/app/data/sessions.json",
  });
  const read = flags.find((flag) => flag.startsWith("--allow-read=")) ?? "";
  const write = flags.find((flag) => flag.startsWith("--allow-write=")) ?? "";
  for (
    const path of [
      "/app/data/catalog.json",
      "/app/data/catalog.json.tmp",
      "/app/data/sessions.json",
      "/app/data/sessions.json.tmp",
    ]
  ) {
    assert(read.includes(path), `review read grant must cover ${path}`);
  }
  for (
    const path of [
      "/app/data/catalog.json",
      "/app/data/catalog.json.tmp",
      "/app/data/sessions.json",
      "/app/data/sessions.json.tmp",
    ]
  ) {
    assert(write.includes(path), `review write grant must cover ${path}`);
  }
  assert(!read.includes("/app/data/identities.json.tmp"), "review never writes identities");
  assert(!write.includes("identities"), "review never writes identities");
});

Deno.test("deploy macos: review extra net stays closed unless Access mapping is on", () => {
  const paths = {
    catalog: "/app/data/catalog.json",
    identities: "/app/data/identities.json",
    sessions: "/app/data/sessions.json",
  };
  const plain = reviewPerms("127.0.0.1", paths);
  assert(
    !plain.some((flag) => flag.includes("cloudflareaccess.com")),
    "no JWKS host without Access",
  );
  const withAccess = reviewPerms("127.0.0.1", paths, [cfAccessNetHost("example")]);
  assert(
    withAccess.includes("--allow-net=example.cloudflareaccess.com"),
    "JWKS host granted when enabled",
  );
  assertEquals(cfAccessNetHost("example"), "example.cloudflareaccess.com");
});

Deno.test("deploy macos: review github hosts stay closed unless GitHub login is on", () => {
  const paths = {
    catalog: "/app/data/catalog.json",
    identities: "/app/data/identities.json",
    sessions: "/app/data/sessions.json",
  };
  const plain = reviewPerms("127.0.0.1", paths);
  assert(!plain.some((flag) => flag.includes("github.com")), "no github hosts without login");
  const withGithub = reviewPerms("127.0.0.1", paths, [...githubNetHosts()]);
  assert(
    withGithub.includes("--allow-net=github.com"),
    "github authorize host granted when enabled",
  );
  assert(withGithub.includes("--allow-net=api.github.com"), "github api host granted when enabled");
});

Deno.test("deploy macos: template keeps the live host out of the repo", async () => {
  for (
    const name of [
      "deploy/macos/run.sh",
      "deploy/macos/run-cloudflared.sh",
      "deploy/macos/config.yml",
      "deploy/macos/render.sh",
      "deploy/macos/verify.sh",
      "deploy/macos/portico.env.example",
      "deploy/macos/net.portico.macstudio.plist",
      "deploy/macos/net.portico.cloudflared.plist",
    ]
  ) {
    const source = await text(name);
    assert(!source.includes("0.0.0.0"), `${name} must not bind all interfaces`);
    assert(
      !/\b(?:10\.\d{1,3}\.\d{1,3}\.\d{1,3}|172\.(?:1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}|192\.168\.\d{1,3}\.\d{1,3})\b/
        .test(source),
      `${name} must not embed an RFC1918 address; the edge bind stays on the host`,
    );
    assert(
      !/\/Users\/(?!example\b|<user>)/.test(source),
      `${name} must use the example home, not a live one`,
    );
  }
});

Deno.test("deploy macos: tunnel client pins update and addressing policy", async () => {
  const source = (await text("deploy/macos/run-cloudflared.sh")).replaceAll("\\\n", " ");
  assert(source.includes("--config"), "tunnel client must run from the versioned ingress file");
  assert(source.includes("--no-autoupdate"), "tunnel client must not self-update under launchd");
  assert(source.includes("--edge-ip-version 4"), "tunnel client must pin IPv4 egress like mira");
  assert(source.includes("PORTICO_EDGE_BIND"), "edge bind address must come from host env");
  assert(
    !source.includes("TUNNEL_TOKEN") && !source.includes("cloudflared.token"),
    "token mode is gone; config mode only",
  );
  assert(
    !source.includes("TUNNEL_TOKEN") && !source.includes("cloudflared.token"),
    "tunnel client must use the credentials file from config.yml, not a token file",
  );
  assert(
    !/eyJ[A-Za-z0-9_-]{10,}/.test(source),
    "tunnel token must never be baked into the template",
  );
});

Deno.test("deploy macos: ingress exposes only the portal with a catch-all", async () => {
  const source = await text("deploy/macos/config.yml");
  assert(
    source.includes("tunnel: TUNNEL_ID"),
    "config template must carry a placeholder tunnel id",
  );
  assert(
    source.includes("credentials-file: /Users/example/portico/portico-macstudio.json"),
    "credentials must live next to the live script, not in the repo",
  );
  assert(
    source.includes("hostname: portico.talkincode.net"),
    "only the Portico hostname is public",
  );
  assert(source.includes("path: ^/review(?:/.*)?$"), "review is routed by path before the portal");
  assert(
    source.includes("service: http://127.0.0.1:8791"),
    "review traffic goes to the review process",
  );
  assert(
    source.includes("service: http://127.0.0.1:8788"),
    "non-review traffic goes to the portal",
  );
  const lines = source.trimEnd().split("\n");
  assertEquals(lines.at(-1)?.trim(), "- service: http_status:404");
  assert(
    !/\b(?:10\.\d{1,3}\.\d{1,3}\.\d{1,3}|172\.(?:1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}|192\.168\.\d{1,3}\.\d{1,3})\b/
      .test(source),
    "config template must not embed an RFC1918 address",
  );
});

Deno.test("deploy macos: render is a closed function of repo plus host values", async () => {
  const source = await text("deploy/macos/render.sh");
  for (
    const required of ["PORTICO_HOME", "PORTICO_TUNNEL_ID", "PORTICO_EDGE_BIND", "PORTICO_USER"]
  ) {
    assert(source.includes(required), `render.sh must require ${required}`);
  }
  assert(source.includes("TUNNEL_ID"), "render.sh must fill the tunnel id");
  assert(source.includes("EDGE_BIND_IP"), "render.sh must fill the egress ip");
  assert(source.includes("<string>example</string>"), "render.sh must fill the daemon user");
  assert(source.includes("portico.env.example"), "render.sh must seed env from the example");
  assert(source.includes("ingress validate"), "render.sh must validate ingress on the host");
});

Deno.test("deploy macos: env example carries all four processes", async () => {
  const source = await text("deploy/macos/portico.env.example");
  for (
    const key of [
      "PORTICO_BIND",
      "PORTICO_DATA_DIR",
      "PORTICO_PORT",
      "PORTICO_GATEWAY_PORT",
      "PORTICO_MCP_PORT",
      "PORTICO_REVIEW_PORT",
    ]
  ) {
    assert(new RegExp(`^${key}=`, "m").test(source), `env example must set ${key}`);
  }
  assert(!/pct1_|pst1_|eyJ[A-Za-z0-9_-]{10,}/.test(source), "env example must not carry secrets");
});

Deno.test("deploy macos: verify gates local and public without writes", async () => {
  const source = await text("deploy/macos/verify.sh");
  // The shipped deployment is the default: four entrances on the loopback and
  // one public origin. They are read from the environment so the gate can be
  // pointed at a deployment (and at a test's own listeners) without editing it.
  for (
    const probe of [
      "PORTICO_DEPLOY_BIND:-127.0.0.1",
      "PORTICO_DEPLOY_PORTAL_PORT:-8788",
      "PORTICO_DEPLOY_GATEWAY_PORT:-8789",
      "PORTICO_DEPLOY_MCP_PORT:-8790",
      "PORTICO_DEPLOY_REVIEW_PORT:-8791",
      "PORTICO_DEPLOY_PUBLIC_ORIGIN:-https://portico.talkincode.net",
      "/public",
      "/review/login",
      "/api/catalog",
      "/internal",
    ]
  ) {
    assert(source.includes(probe), `verify.sh must probe ${probe}`);
  }
  // Ports answering is not the claim: the gate has to name the process serving
  // each entrance, name the revision that process was started from, ask the
  // Gateway whether it executes tools, and ask MCP who it is.
  for (
    const check of ["running-revision", "running-code-not-stale", "gateway-does-not-execute-tools"]
  ) {
    assert(source.includes(check), `verify.sh must report ${check}`);
  }
  assert(
    source.includes("PORTICO_REVISION"),
    "verify.sh must ask the entrance for the variable the launcher records",
  );
  assert(source.includes("mcp-jsonrpc-initialize"), "verify.sh must report mcp-jsonrpc-initialize");
  assert(source.includes('"name":"portico"'), "verify.sh must accept only a portico initialize");
  assert(source.includes('exit "$fail"'), "verify.sh must fail loudly");
});

Deno.test("deploy macos: the launcher records the revision it started from", async () => {
  // `launchctl kickstart -k` is the step that ships a pull, and a restart that
  // never happened leaves the previous revision answering every probe with the
  // same product page. The gate therefore reads the revision the daemons were
  // *started* from back out of their launch environment; this is the half only
  // the launcher can supply, so it is pinned here.
  const source = await text("deploy/macos/run.sh");
  assert(
    /PORTICO_REVISION="\$\(git -C "\$ROOT\/app" rev-parse HEAD/.test(source),
    "run.sh must resolve the revision from the checkout it launches",
  );
  assert(
    /^export PORTICO_REVISION=/m.test(source),
    "run.sh must export the revision so all four entrances inherit it",
  );
  assert(
    !/[0-9a-f]{40}/.test(source),
    "run.sh must not bake a revision into the template",
  );
});

Deno.test("deploy macos: daemons mirror the mira shape", async () => {
  for (
    const [file, program] of [
      ["deploy/macos/net.portico.macstudio.plist", "/Users/example/portico/run.sh"],
      ["deploy/macos/net.portico.cloudflared.plist", "/Users/example/portico/run-cloudflared.sh"],
    ] as const
  ) {
    const source = await text(file);
    assert(source.includes("<string>example</string>"), `${file} must use the example user`);
    assert(source.includes(program), `${file} must run the versioned script path`);
    assert(source.includes("<key>RunAtLoad</key>"), `${file} must start at load`);
    assert(source.includes("<key>KeepAlive</key>"), `${file} must be kept alive`);
  }
});

/**
 * The macOS gate probes behaviour, and behaviour alone cannot tell two
 * revisions apart: a daemon that was never restarted keeps answering 200.
 * The Linux gate pins `PORTICO_EXPECT_SHA` (deploy/verify.sh); the macOS
 * gate has to honour the same pin or a green run says nothing about what
 * shipped.
 *
 * Honouring it was not enough on its own. While the pin stayed optional, a
 * runbook that forgot it got an all-green gate whose strongest claim was never
 * made — the same silence the pin exists to remove. So the pin is now what a
 * run owes by default, and only an explicit `PORTICO_DEPLOY_ALLOW_UNPINNED`
 * turns the omission into a recorded `skip`.
 */
Deno.test("deploy macos: verify requires a revision pin and honours it", async () => {
  const dir = await Deno.makeTempDir({ prefix: "portico-verify-" });
  const decoder = new TextDecoder();
  try {
    const git = async (...args: string[]) => {
      const { code, stderr } = await new Deno.Command("git", {
        args,
        cwd: dir,
        stdout: "null",
        stderr: "piped",
      }).output();
      assert(code === 0, `git ${args.join(" ")} failed: ${decoder.decode(stderr)}`);
    };
    await git("init", "--quiet");
    await Deno.writeTextFile(`${dir}/file.txt`, "x\n");
    await git("add", "file.txt");
    await git(
      "-c",
      "user.email=example@example.invalid",
      "-c",
      "user.name=example",
      "commit",
      "--quiet",
      "-m",
      "x",
    );
    const head = await new Deno.Command("git", {
      args: ["rev-parse", "HEAD"],
      cwd: dir,
      stdout: "piped",
    }).output();
    const sha = decoder.decode(head.stdout).trim();

    // The probes hit 127.0.0.1 and the public site, so they fail in a bare
    // environment; only the revision lines are asserted here.
    //
    // Executed through its own shebang, the way the runbook runs it: `sh`
    // here would be dash on some hosts and the gate is a bash script.
    const run = async (expected?: string, extra: Record<string, string> = {}) => {
      const env: Record<string, string> = {
        PATH: Deno.env.get("PATH") ?? "",
        PORTICO_DEPLOY_TREE: dir,
        ...extra,
      };
      if (expected !== undefined) env.PORTICO_EXPECT_SHA = expected;
      const out = await new Deno.Command(`${ROOT}deploy/macos/verify.sh`, {
        env,
        stdout: "piped",
        stderr: "piped",
      }).output();
      return {
        out: decoder.decode(out.stdout),
        err: decoder.decode(out.stderr),
        code: out.code,
      };
    };

    const pinned = await run(sha);
    assert(
      pinned.out.includes("ok checkout-revision"),
      `a matching pin must confirm the revision it was given, got: ${pinned.out} ${pinned.err}`,
    );

    // The probes cannot pass in a bare environment, so the exit status here is
    // only asserted to be non-zero: the revision line is the contract.
    const mismatch = await run("0".repeat(40));
    assert(
      mismatch.out.startsWith("FAIL checkout-revision"),
      `a mismatched pin must fail first and loudly, got: ${mismatch.out} ${mismatch.err}`,
    );
    assert(mismatch.code !== 0, "a mismatched pin must not exit clean");
    assert(
      !mismatch.out.includes("ok checkout-revision"),
      "a mismatched pin must not also report ok",
    );

    // Unpinned runs keep probing behaviour, but they no longer pass as a
    // verified deployment: nothing in the run names which revision is serving,
    // and that is the one claim a deploy gate exists to make. They fail the
    // revision promise first and loudly, and never invent an `ok` for it.
    const unpinned = await run();
    assert(
      unpinned.out.startsWith("FAIL checkout-revision"),
      `an unpinned run must fail the revision promise first, got: ${unpinned.out} ${unpinned.err}`,
    );
    assert(
      !unpinned.out.includes("ok checkout-revision"),
      "an unpinned run must not report a revision verdict",
    );
    assertEquals(unpinned.code !== 0, true, "an unpinned run must not exit clean");

    // A host whose tree is not a checkout can still be probed, but only by
    // saying so: the accepted run stays a `skip`, so the omission is on the
    // record rather than hidden behind green probes.
    const accepted = await run(undefined, { PORTICO_DEPLOY_ALLOW_UNPINNED: "1" });
    assert(
      accepted.out.startsWith("skip checkout-revision"),
      `an accepted unpinned run must record the omission, got: ${accepted.out} ${accepted.err}`,
    );
    assert(
      !accepted.out.includes("ok checkout-revision"),
      "an accepted unpinned run still must not claim a revision verdict",
    );
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("deploy macos: portal stays read-only without GitHub OAuth", () => {
  const plain = portalPerms("127.0.0.1", false);
  assert(!plain.some((flag) => flag.startsWith("--allow-write")), "no write without github");
  const withGithubButNoPaths = portalPerms("127.0.0.1", true);
  assert(
    !withGithubButNoPaths.some((flag) => flag.startsWith("--allow-write")),
    "no write with github but without paths",
  );
});

Deno.test("deploy macos: portal sessions write grant mirrors review when GitHub OAuth is on", () => {
  const paths = { sessions: "/app/data/sessions.json" };
  const flags = portalPerms("127.0.0.1", true, paths);
  const write = flags.find((flag) => flag.startsWith("--allow-write=")) ?? "";
  assert(write.includes("/app/data/sessions.json"), "portal write grant must cover sessions");
  assert(
    write.includes("/app/data/sessions.json.tmp"),
    "portal write grant must cover sessions.tmp",
  );
  assert(!write.includes("catalog"), "portal must not write catalog");
  assert(!write.includes("identities"), "portal must not write identities");
});

Deno.test("deploy macos: portal github hosts stay closed unless GitHub login is on", () => {
  const plain = portalPerms("127.0.0.1", false);
  assert(!plain.some((flag) => flag.includes("github.com")), "no github hosts without login");
  const withGithub = portalPerms("127.0.0.1", true);
  assert(
    withGithub.some((flag) => flag.includes("github.com")),
    "github authorize host granted when enabled",
  );
  assert(
    withGithub.some((flag) => flag.includes("api.github.com")),
    "github api host granted when enabled",
  );
});
