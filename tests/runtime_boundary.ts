import { listPublicSurfaceFiles } from "./redaction.ts";

/**
 * The L0 runtime boundary, enforced on the shipped tree instead of by reading.
 *
 * The repository contract is "one runtime, one lockfile, no all-open grant":
 * Deno + TypeScript is the only runtime and the only package root, Node and Bun
 * must not appear as a dependency root, a CI step or a spawned executable, and
 * permission flags stay scoped. `docs/roadmap.md` states those as MUST; this
 * module is what fails the build when they stop being true, so the human
 * security audit does not have to be the detector.
 *
 * The tracked tree is the surface, exactly as for the public-surface redaction
 * check: build output, local data and untracked scratch files are not published,
 * so they are not part of this contract either. The two checks share
 * `listPublicSurfaceFiles`, including its refusal to report a clean tree when
 * `git` cannot be read.
 */

export type BoundaryRule =
  /** A tracked Node/Bun manifest, lockfile or version pin. */
  | "node-manifest"
  /** Vendored `node_modules` in the tracked tree. */
  | "vendored-node-modules"
  /** A CI job that installs Node or Bun, or runs its package manager. */
  | "node-toolchain-in-ci"
  /** A `node:` module specifier in shipped source. */
  | "node-specifier"
  /** Spawning `node` / `npm` / `npx` / `bun` / ... as a subprocess. */
  | "node-executable"
  /** `--allow-all`, `-A`, or an unscoped `--allow-net` / `--allow-ffi`. */
  | "open-permissions";

export const BOUNDARY_RULES: readonly BoundaryRule[] = [
  "node-manifest",
  "vendored-node-modules",
  "node-toolchain-in-ci",
  "node-specifier",
  "node-executable",
  "open-permissions",
];

export interface BoundaryFinding {
  rule: BoundaryRule;
  path: string;
  line: number;
  /** What matched, so the line can be found without repeating a whole line. */
  detail: string;
}

export function formatBoundaryFinding(finding: BoundaryFinding): string {
  return `${finding.path}:${finding.line}:${finding.rule}:${finding.detail}`;
}

/**
 * Dependency roots that would make a second runtime real: a manifest, a
 * lockfile, or a version pin. Any of them makes the dependency graph and the
 * permission model split in two, which is what L0 forbids.
 */
const NODE_ROOT_FILES: readonly string[] = [
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
];

const NODE_MODULES_SEGMENT = "node_modules";

const NODE_EXECUTABLES: readonly string[] = [
  "node",
  "npm",
  "npx",
  "npmx",
  "pnpm",
  "pnpmx",
  "yarn",
  "yarnpkg",
  "bun",
  "bunx",
];

const NODE_EXECUTABLE_SET = new Set(NODE_EXECUTABLES);

/** Wrappers that can stand in front of the real command word. */
const COMMAND_PREFIXES = new Set([
  "sudo",
  "exec",
  "command",
  "nohup",
  "env",
  "time",
  "if",
  "then",
  "do",
  "else",
  "elif",
  "while",
]);

const NODE_ACTIONS = /^(?:actions\/setup-node|oven-sh\/setup-bun|oven-sh\/bun)(?:@|$)/;

const NODE_SPAWN = new RegExp(
  `\\bCommand\\s*\\(\\s*["'\`](${NODE_EXECUTABLES.join("|")})["'\`]`,
);

const NODE_MODULE_SPECIFIER =
  /(?:^|[\s({=;,])(?:import|export|require|from)\s*\(?\s*["'`](node:[^"'`\s]+)["'`]/;

const YAML_KEY_VALUE = /^\s*(?:-\s*)?([A-Za-z_][\w.-]*):\s*(.*)$/;
const KEY_EQUALS_VALUE = /^\s*[A-Za-z_][\w.-]*\s*=\s*(.*)$/;

const ALL_OPEN_FLAGS = new Set(["--allow-all", "-A"]);
/**
 * Grants that have no meaning unless they name their target. Bare `--allow-read`
 * / `--allow-write` / `--allow-env` / `--allow-run` are the explicit grants L0
 * asks for; narrowing those to a path or a program is the deployment contract's
 * job, pinned by `tests/deploy_contract_test.ts` against `src/perms.ts`.
 */
const SCOPED_ONLY_FLAGS = new Set(["--allow-net", "--allow-ffi"]);

export type ContentKind =
  /** Shipped TypeScript: imports and subprocess calls are part of the contract. */
  | "source"
  /** Versioned scripts, units and the CI workflow: the command word matters. */
  | "command"
  /** `deno.json`: its tasks are commands, its text carries the permission flags. */
  | "manifest";

/**
 * What the content contract covers: the code and configuration this repository
 * ships or runs. `tests/` is deliberately outside it — the guards above are
 * tested with fixtures that must be able to spell the forbidden shapes, and
 * tests are not shipped. Manifests are still rejected by path in `tests/`, so a
 * tracked `package.json` cannot hide there.
 */
export function contentKind(path: string): ContentKind | undefined {
  if (path === "deno.json" || path === "deno.jsonc") return "manifest";
  if (path.startsWith("src/")) {
    return /\.(?:ts|tsx|js|jsx|mjs)$/.test(path) ? "source" : undefined;
  }
  if (path.startsWith("deploy/")) {
    return /\.(?:sh|service|conf)$/.test(path) ? "command" : undefined;
  }
  if (path.startsWith(".github/")) {
    return /\.(?:yml|yaml)$/.test(path) ? "command" : undefined;
  }
  return undefined;
}

export function classifyPath(path: string): BoundaryFinding[] {
  const segments = path.split("/");
  const base = segments[segments.length - 1];
  const findings: BoundaryFinding[] = [];
  if (NODE_ROOT_FILES.includes(base)) {
    findings.push({ rule: "node-manifest", path, line: 1, detail: base });
  }
  if (segments.includes(NODE_MODULES_SEGMENT)) {
    findings.push({
      rule: "vendored-node-modules",
      path,
      line: 1,
      detail: NODE_MODULES_SEGMENT,
    });
  }
  return findings;
}

const isComment = (text: string): boolean => /^\s*(?:#|\/\/|\*|\/\*)/.test(text);

/** Strips the wrapping quotes of a command word, so `"$DOCKER"` is comparable. */
const bare = (token: string): string => token.replace(/^["'`]+|["'`]+$/g, "");

/**
 * The command word of a line, after the wrappers and, for key/value syntax, the
 * key. `run: npm ci`, `ExecStart=/usr/bin/npm ci` and `exec node x.js` all have
 * to resolve to the same word for the rule to mean anything.
 */
function commandWord(text: string): string | undefined {
  const candidates = [text.trim()];
  for (const shape of [YAML_KEY_VALUE, KEY_EQUALS_VALUE]) {
    const match = shape.exec(text);
    if (match) candidates.push(match[match.length - 1].trim());
  }
  for (const candidate of candidates) {
    const tokens = candidate
      .split(/[\s;&|]+/)
      .map(bare)
      .filter(Boolean);
    let index = 0;
    while (index < tokens.length && COMMAND_PREFIXES.has(tokens[index])) index += 1;
    const word = tokens[index];
    if (word === undefined) continue;
    if (NODE_EXECUTABLE_SET.has(word)) return word;
  }
  return undefined;
}

function scanPermissions(path: string, text: string): BoundaryFinding[] {
  const findings: BoundaryFinding[] = [];
  const lines = text.split("\n");
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (isComment(line)) continue;
    for (const token of line.split(/[\s,;:()[\]{}"'`]+/)) {
      if (!token.startsWith("-")) continue;
      if (ALL_OPEN_FLAGS.has(token) || SCOPED_ONLY_FLAGS.has(token)) {
        findings.push({
          rule: "open-permissions",
          path,
          line: index + 1,
          detail: token,
        });
      }
    }
  }
  return findings;
}

function scanSource(path: string, text: string): BoundaryFinding[] {
  const findings: BoundaryFinding[] = [];
  const lines = text.split("\n");
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (isComment(line)) continue;
    const executable = NODE_SPAWN.exec(line);
    if (executable) {
      findings.push({
        rule: "node-executable",
        path,
        line: index + 1,
        detail: executable[1],
      });
    }
    const specifier = NODE_MODULE_SPECIFIER.exec(line);
    if (specifier) {
      findings.push({
        rule: "node-specifier",
        path,
        line: index + 1,
        detail: specifier[1],
      });
    }
  }
  return findings;
}

function scanCommands(path: string, text: string): BoundaryFinding[] {
  const findings: BoundaryFinding[] = [];
  const lines = text.split("\n");
  const isCi = path.startsWith(".github/");
  const rule: BoundaryRule = isCi ? "node-toolchain-in-ci" : "node-executable";
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (isComment(line)) continue;
    if (isCi) {
      const action = /^\s*(?:-\s*)?uses:\s*(\S+)/.exec(line);
      if (action) {
        if (NODE_ACTIONS.test(action[1])) {
          findings.push({
            rule: "node-toolchain-in-ci",
            path,
            line: index + 1,
            detail: action[1],
          });
        }
        continue;
      }
    }
    const word = commandWord(line);
    if (word) {
      findings.push({ rule, path, line: index + 1, detail: word });
    }
  }
  return findings;
}

function scanManifest(path: string, text: string): BoundaryFinding[] {
  let tasks: Record<string, unknown>;
  try {
    const parsed = JSON.parse(text) as { tasks?: Record<string, unknown> };
    tasks = parsed.tasks ?? {};
  } catch {
    return [];
  }
  const lines = text.split("\n");
  const findings: BoundaryFinding[] = [];
  for (const [name, value] of Object.entries(tasks)) {
    if (typeof value !== "string") continue;
    const word = commandWord(value);
    if (!word) continue;
    const at = lines.findIndex((line) => line.includes(value));
    findings.push({
      rule: "node-executable",
      path,
      line: at === -1 ? 1 : at + 1,
      detail: `${name}: ${word}`,
    });
  }
  return findings;
}

/**
 * Where a permission flag is a grant this repository applies, rather than text
 * it renders: the task manifest, the versioned deployment scripts and CI. A
 * portal page that prints `deno run -A <package>` is telling a reader how to run
 * a *registered third-party* package — Portico grants nothing there and executes
 * nothing — so `src/` is out of the permission rule on purpose. The profiles in
 * `src/perms.ts` stay pinned by `tests/deploy_contract_test.ts`.
 *
 * The other half of the honest boundary: this catches literal spellings in the
 * command positions above. It cannot prove the absence of a granted permission
 * assembled at runtime, and it does not police what a registered package does on
 * the reader's machine.
 */
export function scanRuntimeText(path: string, text: string): BoundaryFinding[] {
  const kind = contentKind(path);
  if (!kind) return [];
  if (kind === "source") return scanSource(path, text);
  const findings = scanPermissions(path, text);
  if (kind === "manifest") {
    return [...findings, ...scanManifest(path, text)];
  }
  return [...findings, ...scanCommands(path, text)];
}

export async function scanRuntimeBoundary(
  root = ".",
  binary = "git",
): Promise<{ scanned: number; findings: BoundaryFinding[] }> {
  const files = await listPublicSurfaceFiles(root, binary);
  const findings: BoundaryFinding[] = [];
  let scanned = 0;
  for (const file of files) {
    findings.push(...classifyPath(file));
    if (!contentKind(file)) continue;
    let text: string;
    try {
      text = await Deno.readTextFile(`${root}/${file}`);
    } catch {
      continue;
    }
    if (text.includes("\0")) continue;
    scanned += 1;
    findings.push(...scanRuntimeText(file, text));
  }
  return { scanned, findings };
}
