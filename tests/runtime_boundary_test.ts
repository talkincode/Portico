import { assert, assertEquals } from "./assert.ts";
import {
  BOUNDARY_RULES,
  type BoundaryRule,
  classifyPath,
  contentKind,
  formatBoundaryFinding,
  scanRuntimeBoundary,
  scanRuntimeText,
} from "./runtime_boundary.ts";

/**
 * The L0 runtime boundary is the one iron rule that had no automated guard: the
 * repository could grow a Node manifest, a second lockfile, a CI job that sets
 * up Node, or a `node:` import, and every existing check would stay green. The
 * human security audit is asked to look for exactly those shapes, so the shapes
 * are pinned here instead of by inspection.
 */

const rulesOf = (findings: { rule: BoundaryRule }[]): BoundaryRule[] =>
  findings.map((finding) => finding.rule);

Deno.test("a Node or Bun dependency root is a finding wherever it sits", () => {
  const flagged = [
    "package.json",
    "package-lock.json",
    "npm-shrinkwrap.json",
    "yarn.lock",
    "pnpm-lock.yaml",
    "pnpm-workspace.yaml",
    "bun.lock",
    "bun.lockb",
    "bunfig.toml",
    ".nvmrc",
    ".node-version",
    "examples/package.json",
    "docs/tooling/bun.lock",
  ];
  for (const path of flagged) {
    assertEquals(rulesOf(classifyPath(path)), ["node-manifest"], path);
  }
});

Deno.test("the tracked tree this project actually ships is not a Node manifest", () => {
  const kept = [
    "deno.json",
    "src/catalog/service.ts",
    "deploy/run-portal.sh",
    "docs/roadmap.md",
    "data/catalog.json",
    "package-entry.ts",
  ];
  for (const path of kept) {
    assertEquals(classifyPath(path), [], path);
  }
});

Deno.test("vendored Node modules are a finding at any depth", () => {
  assertEquals(rulesOf(classifyPath("node_modules/foo/index.js")), ["vendored-node-modules"]);
  assertEquals(rulesOf(classifyPath("src/node_modules/foo.js")), ["vendored-node-modules"]);
  assertEquals(classifyPath("src/nodes/index.ts"), []);
});

Deno.test("an all-open Deno grant is a finding", () => {
  for (
    const text of [
      "deno run --allow-all src/cli/main.ts",
      "deno test -A tests/",
      "deno run --allow-read --allow-all",
    ]
  ) {
    assertEquals(rulesOf(scanRuntimeText("deno.json", text)), ["open-permissions"], text);
  }
});

Deno.test("an unscoped network or ffi grant is a finding", () => {
  for (const text of ["deno run --allow-net src/portal/main.ts", "deno run --allow-ffi"]) {
    assertEquals(rulesOf(scanRuntimeText("deno.json", text)), ["open-permissions"], text);
  }
});

Deno.test("the scoped grants the product actually uses are not findings", () => {
  const kept = [
    "deno test --allow-read --allow-write --allow-env --allow-run --allow-net=127.0.0.1 tests/",
    'deno run --allow-read=/app --allow-env --allow-net=127.0.0.1,"$BIND" src/portal/main.ts',
    'return ["--allow-read", "--allow-write", "--allow-env"];',
  ];
  for (const text of kept) {
    assertEquals(scanRuntimeText("deno.json", text), [], text);
  }
  // A flag named in prose or in a comment is documentation, not a grant.
  assertEquals(scanRuntimeText("deploy/notes.md", "see the `--allow-net` allow-list"), []);
  assertEquals(scanRuntimeText("deploy/run-portal.sh", "# --allow-all is never used here"), []);
});

Deno.test("a rendered command for a registered package is not a grant", () => {
  // `src/portal/html.ts` prints the command a reader may run for a *registered
  // third-party* package. Portico grants nothing and executes nothing there, so
  // the permission rule does not apply to rendered text; the profiles this
  // repository really applies are pinned by `tests/deploy_contract_test.ts`.
  assertEquals(
    scanRuntimeText("src/portal/html.ts", "return escapeHtml(`deno run -A ${pkg}`);"),
    [],
  );
  assertEquals(
    scanRuntimeText("src/portal/html.ts", 'usage: "deno run --allow-all jsr:@scope/tool",'),
    [],
  );
});

Deno.test("a Node builtin import is a finding, an npm: adapter import is not", () => {
  const flagged = [
    'import { readFile } from "node:fs/promises";',
    "const path = await import('node:path');",
  ];
  for (const text of flagged) {
    assertEquals(rulesOf(scanRuntimeText("src/runtime/spawn.ts", text)), ["node-specifier"], text);
  }
  assertEquals(scanRuntimeText("src/catalog/service.ts", 'import sdk from "npm:@scope/sdk";'), []);
  assertEquals(
    scanRuntimeText("src/catalog/service.ts", "const pattern = /^npm:([a-z]+)$/;"),
    [],
  );
});

Deno.test("spawning a Node or Bun executable is a finding", () => {
  const flagged = [
    'new Deno.Command("node", { args: ["index.js"] });',
    'await new Deno.Command("npx", { args: ["-y", "pkg"] }).output();',
    'Deno.Command("bun", { args: ["run", "start"] });',
  ];
  for (const text of flagged) {
    assertEquals(rulesOf(scanRuntimeText("src/runtime/spawn.ts", text)), ["node-executable"], text);
  }
});

Deno.test("naming a package coordinate for a reader is not spawning an executable", () => {
  // `src/portal/html.ts` renders `npm:` coordinates as the command a reader may
  // run themselves; Portico never executes it. The rule must stay on the spawn
  // call, not on the word.
  assertEquals(
    scanRuntimeText("src/portal/html.ts", "return escapeHtml(`npx ${pkg.slice(4)}`);"),
    [],
  );
  assertEquals(scanRuntimeText("src/portal/html.ts", 'value: "npx -y @example/docs-writer",'), []);
});

Deno.test("a CI job that sets up Node or Bun is a finding", () => {
  const flagged = [
    ["- uses: actions/setup-node@v5", "node-toolchain-in-ci"],
    ["- uses: oven-sh/setup-bun@v1", "node-toolchain-in-ci"],
    ["        run: npm ci", "node-toolchain-in-ci"],
    ["        run: npm install --global pkg", "node-toolchain-in-ci"],
    ["      - run: bun install", "node-toolchain-in-ci"],
    ["      - run: npx --yes some-tool", "node-toolchain-in-ci"],
    ["      - run: pnpm test", "node-toolchain-in-ci"],
  ] as const;
  for (const [line, rule] of flagged) {
    assertEquals(
      rulesOf(scanRuntimeText(".github/workflows/ci.yml", `${line}\n`)),
      [rule],
      line,
    );
  }
});

Deno.test("the CI this repository actually runs stays on one runtime", () => {
  const kept = [
    "      - uses: actions/checkout@v5",
    "      - uses: denoland/setup-deno@v2",
    "        run: deno fmt --check",
    "        run: deno task test",
    "        run: deno task build",
    "  # npm install is deliberately absent: the runtime is Deno",
  ];
  for (const line of kept) {
    assertEquals(scanRuntimeText(".github/workflows/ci.yml", `${line}\n`), [], line);
  }
});

Deno.test("invoking a Node toolchain from a script is a finding", () => {
  const flagged = [
    "npm run build",
    "exec node dist/main.js",
    "sudo npm ci",
    "bun run start",
  ];
  for (const line of flagged) {
    assertEquals(
      rulesOf(scanRuntimeText("deploy/run-portal.sh", `${line}\n`)),
      ["node-executable"],
      line,
    );
  }
  const kept = [
    'exec "$DOCKER" run --rm --name portico-portal --network host',
    "deno run --allow-read=/app src/portal/main.ts",
    "# node is never invoked here",
  ];
  for (const line of kept) {
    assertEquals(scanRuntimeText("deploy/run-portal.sh", `${line}\n`), [], line);
  }
});

Deno.test("a deno.json task that shells out to Node is a finding", () => {
  const manifest = JSON.stringify({
    tasks: { dev: "npm run dev", ok: "deno run src/cli/main.ts" },
  });
  const findings = scanRuntimeText("deno.json", manifest);
  assertEquals(rulesOf(findings), ["node-executable"]);
  assert(findings[0].line >= 1, "a manifest finding must still carry a line");
});

Deno.test("only shipped configuration and source carry the content contract", () => {
  assertEquals(contentKind("deno.json"), "manifest");
  assertEquals(contentKind("src/catalog/service.ts"), "source");
  assertEquals(contentKind("deploy/run-gateway.sh"), "command");
  assertEquals(contentKind(".github/workflows/ci.yml"), "command");
  assertEquals(contentKind("README.md"), undefined);
  assertEquals(contentKind("docs/roadmap.md"), undefined);
  assertEquals(contentKind("tests/runtime_boundary_test.ts"), undefined);
  assertEquals(contentKind("data/catalog.json"), undefined);
});

Deno.test("a finding names the file, line, rule and what matched", () => {
  const finding = scanRuntimeText(".github/workflows/ci.yml", "jobs:\n  run: npm ci\n")[0];
  assertEquals(finding.line, 2);
  assertEquals(
    formatBoundaryFinding(finding),
    ".github/workflows/ci.yml:2:node-toolchain-in-ci:npm",
  );
});

Deno.test("every declared rule is exercised by a fixture above", () => {
  const exercised = new Set<BoundaryRule>([
    ...rulesOf(classifyPath("package.json")),
    ...rulesOf(classifyPath("node_modules/x.js")),
    ...rulesOf(scanRuntimeText("deno.json", "deno run --allow-all")),
    ...rulesOf(scanRuntimeText("src/a.ts", 'import "node:fs";')),
    ...rulesOf(scanRuntimeText("src/a.ts", 'new Deno.Command("node");')),
    ...rulesOf(scanRuntimeText(".github/workflows/ci.yml", "run: npm ci")),
  ]);
  for (const rule of BOUNDARY_RULES) {
    assert(exercised.has(rule), `rule '${rule}' has no fixture that reaches it`);
  }
  assertEquals(exercised.size, BOUNDARY_RULES.length);
});

Deno.test("the tracked tree carries no Node or Bun root and no open grant", async () => {
  const { scanned, findings } = await scanRuntimeBoundary();
  assertEquals(findings.map(formatBoundaryFinding), []);
  assert(scanned > 10, `expected to read the shipped tree, saw ${scanned} files`);
});

Deno.test("the scan refuses to report a clean boundary when git cannot run", async () => {
  const missing = "git-not-installed-here";
  let message = "";
  try {
    await scanRuntimeBoundary(".", missing);
  } catch (error) {
    message = (error as Error).message;
  }
  assert(message.includes(missing), `the refusal must name the binary: ${message}`);
  assert(message.includes("refus"), `the refusal must say it is refusing: ${message}`);
});

Deno.test("the boundary check is reachable on its own and inside the suite", async () => {
  const config = JSON.parse(
    await Deno.readTextFile(new URL("../deno.json", import.meta.url)),
  ) as { tasks: Record<string, string> };
  const dedicated = config.tasks["check:runtime-boundary"];
  assert(dedicated, "deno.json must expose check:runtime-boundary");
  assert(
    dedicated.includes("tests/runtime_boundary_test.ts"),
    `the task must run this file: ${dedicated}`,
  );
  assert(
    !dedicated.includes("--allow-all"),
    `the task must not open every permission: ${dedicated}`,
  );
  assert(
    config.tasks.test.includes("tests/"),
    `deno task test must run the tests directory: ${config.tasks.test}`,
  );
});
