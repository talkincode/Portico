import { assert, assertEquals } from "./assert.ts";

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

Deno.test("deploy macos: template keeps the live host out of the repo", async () => {
  for (
    const name of [
      "deploy/macos/run.sh",
      "deploy/macos/run-cloudflared.sh",
      "deploy/macos/config.yml",
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
    assert(!source.includes("/Users/wangjuntao"), `${name} must use the example home, not a live one`);
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
    "tunnel client must use the credentials file from config.yml, not a token file",
  );
  assert(
    !/eyJ[A-Za-z0-9_-]{10,}/.test(source),
    "tunnel token must never be baked into the template",
  );
});

Deno.test("deploy macos: ingress exposes only the portal with a catch-all", async () => {
  const source = await text("deploy/macos/config.yml");
  assert(source.includes("tunnel: TUNNEL_ID"), "config template must carry a placeholder tunnel id");
  assert(
    source.includes("credentials-file: /Users/example/portico/portico-macstudio.json"),
    "credentials must live next to the live script, not in the repo",
  );
  assert(source.includes("hostname: portico.talkincode.net"), "only the Portico hostname is public");
  assert(source.includes("path: ^/review(?:/.*)?$"), "review is routed by path before the portal");
  assert(source.includes("service: http://127.0.0.1:8791"), "review traffic goes to the review process");
  assert(source.includes("service: http://127.0.0.1:8788"), "non-review traffic goes to the portal");
  const lines = source.trimEnd().split("\n");
  assertEquals(lines.at(-1)?.trim(), "- service: http_status:404");
  assert(
    !/\b(?:10\.\d{1,3}\.\d{1,3}\.\d{1,3}|172\.(?:1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}|192\.168\.\d{1,3}\.\d{1,3})\b/
      .test(source),
    "config template must not embed an RFC1918 address",
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
