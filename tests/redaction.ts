/**
 * Public-surface redaction check.
 *
 * This repository is open source. Anything that lands in a tracked file — code,
 * comments, fixtures, docs, deploy scripts — is public the moment it is
 * committed. Two classes of value must never appear there:
 *
 * 1. credentials, and
 * 2. the coordinates of the live intranet the deployment runs on.
 *
 * The check is shape based on purpose. Naming the live hosts or blocks
 * explicitly would mean writing them into the repository, which is the very
 * leak it exists to prevent — the same reasoning as the approval-time check in
 * `src/catalog/service.ts`. Generic documentation addresses stay writable
 * through the exemptions below, and every exemption carries a written reason
 * and is proven still needed by the tests, so the list cannot rot into a
 * blanket pass.
 *
 * Findings never echo the matched value: they are masked, because a CI log of a
 * public repository is itself a public surface. The file and line are enough
 * for the author to look the value up locally.
 */

export type Rule = "secret-shape" | "private-address" | "single-label-host";

export interface Finding {
  rule: Rule;
  path: string;
  line: number;
  /** The exact matched text. Used for exemptions and stale-entry detection. */
  value: string;
  /** What a report may show instead of the value. */
  masked: string;
}

/**
 * Words that mark a fixture as synthetic. They are deliberately narrow:
 * "example" or "sample" appear in ordinary prose about real systems, so a line
 * carrying one of those would be exempt without anyone deciding to exempt it.
 */
const SYNTHETIC_MARKERS = ["notareal", "fake", "dummy", "synthetic", "placeholder", "redacted"];

/** The issuer-prefix families the catalog also rejects in surface metadata. */
const ISSUER_PREFIX_FAMILIES = [
  "sk[-_]",
  "ghp_",
  "gho_",
  "ghu_",
  "ghs_",
  "ghr_",
  "github_pat_",
  "glpat-",
  "xox[baprs]-",
];

const SECRET_SHAPES = new RegExp(
  [
    // Prefix families need a minimum tail, so prose that merely mentions a
    // prefix ("the catalog rejects ghp_ shaped values") is not a finding.
    `(?<![A-Za-z0-9_])(?:${
      ISSUER_PREFIX_FAMILIES.map((prefix) => `${prefix}[A-Za-z0-9_-]{8,}`).join("|")
    })`,
    // Fixed-shape families, identical to the catalog's: AWS access key ids,
    // Google API keys, PEM private-key headers, npm access tokens.
    `(?<![A-Za-z0-9])(?:AKIA|ASIA)[A-Z0-9]{16}(?![A-Z0-9])`,
    `(?<![A-Za-z0-9_-])AIza[0-9A-Za-z_-]{35}(?![A-Za-z0-9_-])`,
    `-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----`,
    `(?<![A-Za-z0-9_])npm_[A-Za-z0-9]{36}(?![A-Za-z0-9])`,
  ].join("|"),
  "g",
);

/**
 * Reserved IPv4 blocks that the public internet cannot reach. 127/8 is
 * deliberately absent: loopback is the documented placeholder for local
 * examples, and a wildcard bind is a deployment-contract concern
 * (`tests/deploy_contract_test.ts`), not a topology leak.
 */
const PRIVATE_IPV4 =
  /(?<![\d.])(?:10\.\d{1,3}\.\d{1,3}\.\d{1,3}|172\.(?:1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}|192\.168\.\d{1,3}\.\d{1,3}|169\.254\.\d{1,3}\.\d{1,3}|100\.(?:6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.\d{1,3}\.\d{1,3})(?!\d)/g;

/** ULA (fc00::/7) and link-local (fe80::/10) literals, which are never public. */
const PRIVATE_IPV6 = /(?<![0-9A-Za-z:])(?:f[cd][0-9a-f]{2}|fe[89ab][0-9a-f]):[0-9a-f:]{2,}/g;

/** URL shapes, used to find hosts that public DNS could not serve. */
const URL_WITH_AUTHORITY = /https?:\/\/([^\s"'<>`)\]]+)/g;

/**
 * Generic documentation coordinates already used by the rule-defining tests and
 * by `docs/`. Each one is a canonical example address, never a live one, and
 * listing them publicly reveals nothing: they are the addresses every network
 * textbook uses.
 */
export const ALLOWED_PRIVATE_ADDRESSES: readonly { octets: readonly number[]; reason: string }[] = [
  {
    octets: [10, 0, 0, 1],
    reason: "first address of 10/8, used to prove the bind parser accepts the block",
  },
  {
    octets: [10, 255, 255, 254],
    reason: "last usable address of 10/8, used to prove the block edge is accepted",
  },
  {
    octets: [172, 16, 0, 1],
    reason: "first address of 172.16/12, used to prove the bind parser accepts the block",
  },
  {
    octets: [172, 31, 255, 254],
    reason: "last usable address of 172.16/12, used to prove the block edge is accepted",
  },
  {
    octets: [192, 168, 0, 1],
    reason: "first address of 192.168/16, used to prove the bind parser accepts the block",
  },
  {
    octets: [192, 168, 1, 10],
    reason: "generic host inside 192.168/16, used to prove bind parsing and approval rejection",
  },
  {
    octets: [192, 168, 255, 254],
    reason: "last usable address of 192.168/16, used to prove the block edge is accepted",
  },
  {
    octets: [169, 254, 1, 1],
    reason: "generic link-local address, used to prove the bind parser refuses it",
  },
  {
    octets: [10, 0, 0, 5],
    reason: "generic private endpoint, used to prove approval rejects intranet entries",
  },
  {
    octets: [10, 20, 30, 40],
    reason: "generic private MCP endpoint, used to prove approval rejects intranet endpoints",
  },
  {
    octets: [172, 16, 4, 4],
    reason: "generic 172.16/12 endpoint, used to prove approval rejects intranet entries",
  },
  {
    octets: [169, 254, 10, 10],
    reason: "generic link-local endpoint, used to prove approval rejects intranet entries",
  },
  {
    octets: [192, 168, 1, 100],
    reason: "documented example of an RFC1918 unicast bind address in docs/ops/env-vars.md",
  },
];

/**
 * ULA and link-local prefixes are exempted by leading group rather than by
 * exact address: the fixtures need "some ULA" and "some link-local address",
 * and every address in those blocks is documentation-only by definition.
 */
export const IPV6_DOCUMENTATION_PREFIXES: readonly { groups: string; reason: string }[] = [
  { groups: "fd00", reason: "canonical ULA documentation prefix used to prove rejection" },
  { groups: "fe80", reason: "canonical link-local prefix used to prove rejection" },
];

/**
 * Placeholder hostnames for single-label fixtures. Real intranet names are never
 * listed anywhere in this repository; a fixture only needs *a* name without a
 * dot to prove the rule, and these two read as placeholders on sight.
 */
export const ALLOWED_INTERNAL_LABELS: readonly { label: string; reason: string }[] = [
  { label: "intranet", reason: "placeholder host in approval fixtures for single-label rejection" },
  { label: "wiki", reason: "second placeholder host, proving the rule is not name-specific" },
  {
    label: "host",
    reason: "documented placeholder in the credential-in-URL counter-example in docs/",
  },
];

export function redact(value: string): string {
  const head = value.slice(0, 4);
  return `${head}…(${value.length} chars)`;
}

export function formatFinding(finding: Finding): string {
  return `${finding.path}:${finding.line}: ${finding.rule}: ${finding.masked}`;
}

function isMarkedSynthetic(line: string): boolean {
  const squashed = line.toLowerCase().replace(/[^a-z0-9]/g, "");
  return SYNTHETIC_MARKERS.some((marker) => squashed.includes(marker));
}

function isExemptPrivateAddress(value: string): boolean {
  const octets = value.split(".").map(Number);
  return ALLOWED_PRIVATE_ADDRESSES.some((entry) =>
    entry.octets.length === octets.length &&
    entry.octets.every((octet, index) => octet === octets[index])
  );
}

function isExemptIpv6(value: string): boolean {
  const groups = value.split(":")[0].toLowerCase();
  return IPV6_DOCUMENTATION_PREFIXES.some((entry) => entry.groups === groups);
}

function isExemptLabel(value: string): boolean {
  return ALLOWED_INTERNAL_LABELS.some((entry) => entry.label === value.toLowerCase());
}

/**
 * An address that is only the first label of a dotted name (`10.1.2.3.docs.example.com`)
 * is a public hostname that happens to look numeric, not an intranet
 * coordinate: a trailing dot followed by a letter means more labels follow.
 */
function startsAnotherLabel(text: string, end: number): boolean {
  return /^\.[A-Za-z]/.test(text.slice(end));
}

/**
 * The host of a URL, with userinfo, port and IPv6 brackets removed. A
 * credential-in-URL counter-example in the docs (`https://user:password@host`)
 * must have its *host* judged, while the userinfo itself is not a host at all.
 */
function hostOfAuthority(authority: string): string {
  const afterUserinfo = authority.slice(authority.lastIndexOf("@") + 1);
  const hostAndPort = afterUserinfo.split(/[/?#]/)[0];
  if (hostAndPort.startsWith("[")) {
    const end = hostAndPort.indexOf("]");
    return end === -1 ? "" : hostAndPort.slice(1, end);
  }
  return hostAndPort.split(":")[0];
}

/**
 * An authority that is a reference rather than a literal is not a coordinate:
 * `http://${HOST}:8790/mcp` and `http://$MCP_HOST:8790/mcp` name an address the
 * runtime supplies. Recommending the variable form is the point of the check,
 * so the variable form cannot be what the check flags.
 */
function isUnresolvedAuthority(host: string): boolean {
  return host.startsWith("$") || host.includes("{");
}

/** Everything that looks like a leak, before exemptions. */
export function collectShapeFindings(text: string, path: string): Finding[] {
  const findings: Finding[] = [];
  text.split("\n").forEach((line, index) => {
    const lineNumber = index + 1;
    const push = (rule: Rule, value: string) =>
      findings.push({ rule, path, line: lineNumber, value, masked: redact(value) });
    if (!isMarkedSynthetic(line)) {
      for (const match of line.matchAll(SECRET_SHAPES)) push("secret-shape", match[0]);
    }
    for (const match of line.matchAll(PRIVATE_IPV4)) {
      if (!startsAnotherLabel(line, match.index + match[0].length)) {
        push("private-address", match[0]);
      }
    }
    for (const match of line.matchAll(PRIVATE_IPV6)) push("private-address", match[0]);
    for (const match of line.matchAll(URL_WITH_AUTHORITY)) {
      const host = hostOfAuthority(match[1]);
      if (host === "" || host.includes(".") || host.includes(":")) continue;
      if (host.toLowerCase() === "localhost") continue;
      if (isUnresolvedAuthority(host)) continue;
      push("single-label-host", host);
    }
  });
  return findings;
}

/** The findings that a commit must not contain. */
export function scanText(text: string, path: string): Finding[] {
  return collectShapeFindings(text, path).filter((finding) => {
    if (finding.rule === "private-address") {
      return finding.value.includes(":")
        ? !isExemptIpv6(finding.value)
        : !isExemptPrivateAddress(finding.value);
    }
    if (finding.rule === "single-label-host") return !isExemptLabel(finding.value);
    return true;
  });
}

const decoder = new TextDecoder();

async function gitLines(root: string, args: string[]): Promise<string[]> {
  const output = await new Deno.Command("git", {
    args: ["-C", root, ...args],
    stdout: "piped",
    stderr: "piped",
  }).output();
  if (!output.success) {
    throw new Error(
      `git ${args.join(" ")} failed: ${decoder.decode(output.stderr).trim()}`,
    );
  }
  return decoder.decode(output.stdout).split("\0").filter(Boolean);
}

/**
 * The public surface is exactly what git would publish: tracked files. Build
 * output, local data and untracked scratch files are not in it, which is why
 * this asks git instead of walking the working tree.
 */
export async function listPublicSurfaceFiles(root = "."): Promise<string[]> {
  return await gitLines(root, ["ls-files", "-z"]);
}

export async function scanRepository(
  root = ".",
): Promise<{ scanned: number; findings: Finding[] }> {
  const files = await listPublicSurfaceFiles(root);
  const findings: Finding[] = [];
  let scanned = 0;
  for (const file of files) {
    let text: string;
    try {
      text = await Deno.readTextFile(`${root}/${file}`);
    } catch {
      continue;
    }
    if (text.includes("\0")) continue;
    scanned += 1;
    findings.push(...scanText(text, file));
  }
  return { scanned, findings };
}
