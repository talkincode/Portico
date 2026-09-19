import { assert, assertEquals } from "./assert.ts";
import {
  ALLOWED_INTERNAL_LABELS,
  ALLOWED_PRIVATE_ADDRESSES,
  collectShapeFindings,
  formatFinding,
  IPV6_DOCUMENTATION_PREFIXES,
  listPublicSurfaceFiles,
  redact,
  scanRepository,
  scanText,
} from "./redaction.ts";

/**
 * Every forbidden shape in this file is assembled at runtime from fragments.
 * Writing one literally would make this test the first finding of the check it
 * verifies, which is exactly what a reader should see: a real credential or a
 * live intranet coordinate never appears as a literal in this repository, not
 * even to test the scanner that looks for them.
 */
const glue = (...chunks: string[]): string => chunks.join("");
const address = (...octets: number[]): string => octets.join(".");

const ISSUER_TOKEN = glue("ghp_", "0123456789abcdefghij");
const AWS_KEY = glue("AK", "IA", "0123456789ABCDEF");
const GOOGLE_KEY = glue("AIza", "0123456789abcdefghijklmnopqrstuvwxy");
const NPM_TOKEN = glue("npm_", "0123456789abcdefghijklmnopqrstuvwxyz");
const PEM_HEADER = glue("-----BEGIN ", "PRIVATE KEY-----");

const RFC1918_TEN = address(10, 4, 5, 6);
const RFC1918_172 = address(172, 20, 1, 1);
const RFC1918_192 = address(192, 168, 9, 9);
const LINK_LOCAL = address(169, 254, 3, 4);
const CARRIER_NAT = address(100, 100, 1, 1);
const LOOPBACK = address(127, 0, 0, 1);
const TEST_NET = address(192, 0, 2, 10);
const PUBLIC_DNS = address(9, 9, 9, 9);
const IP_LOOKING_DOMAIN = glue(address(10, 1, 2, 3), ".docs.example.com");
const SINGLE_LABEL_HOST = glue("dev", "host01");

Deno.test("a pasted issuer-prefixed credential is flagged and never echoed", () => {
  const findings = scanText(`const token = "${ISSUER_TOKEN}";`, "example.ts");
  assertEquals(findings.length, 1);
  assertEquals(findings[0].rule, "secret-shape");
  assertEquals(findings[0].line, 1);
  const rendered = formatFinding(findings[0]);
  assert(rendered.includes("example.ts:1"), rendered);
  assert(!rendered.includes(ISSUER_TOKEN), "the finding must not repeat the credential");
});

Deno.test("every credential family the catalog rejects is flagged in a file too", () => {
  const cases: [string, string][] = [
    ["aws access key id", AWS_KEY],
    ["google api key", GOOGLE_KEY],
    ["npm access token", NPM_TOKEN],
    ["pem private key header", PEM_HEADER],
  ];
  for (const [name, value] of cases) {
    const findings = scanText(`name: "${value}"`, "surface.json");
    assertEquals(findings.map((finding) => finding.rule), ["secret-shape"], name);
  }
});

Deno.test("prose that only mentions an issuer prefix is not a credential", () => {
  assertEquals(scanText("the catalog rejects ghp_ and AKIA shaped values", "docs.md"), []);
  assertEquals(scanText("rotate the private key out of band", "docs.md"), []);
});

Deno.test("a synthetic fixture is exempt only when its line says so", () => {
  const marked = glue("sk-live-", "not-a-real", "-value-0123456789");
  assertEquals(scanText(`const fixture = "${marked}";`, "fixtures.ts"), []);
  const unmarkedTwin = glue("sk-live-", "ordinary-free", "-uuid-0123456789");
  assertEquals(scanText(`const fixture = "${unmarkedTwin}";`, "fixtures.ts").length, 1);
});

Deno.test("the marker must be on the finding's own line, not merely nearby", () => {
  const unmarked = glue("ghp_", "0123456789abcdefghij");
  const text = ["// synthetic fixtures below", `const token = "${unmarked}";`].join("\n");
  assertEquals(scanText(text, "fixtures.ts").map((finding) => finding.line), [2]);
});

Deno.test("private IPv4 coordinates are flagged across every reserved block", () => {
  const flagged = [RFC1918_TEN, RFC1918_172, RFC1918_192, LINK_LOCAL, CARRIER_NAT];
  for (const value of flagged) {
    const findings = scanText(`bind: "${value}"`, "deploy.conf");
    assertEquals(findings.map((finding) => finding.rule), ["private-address"], value);
  }
});

Deno.test("loopback, public, and documentation addresses stay writable", () => {
  for (const value of [LOOPBACK, TEST_NET, PUBLIC_DNS]) {
    assertEquals(scanText(`bind: "${value}"`, "deploy.conf"), [], value);
  }
  assertEquals(scanText("the rule covers 10/8, 172.16/12 and 192.168/16", "docs.md"), []);
  assertEquals(scanText(`href: "https://${IP_LOOKING_DOMAIN}/agent"`, "docs.md"), []);
});

Deno.test("only global unicast IPv6 literals are treated as publishable", () => {
  for (const value of [glue("fd", "99::1"), glue("fe", "90::1")]) {
    const findings = scanText(`endpoint: "https://[${value}]/mcp"`, "surface.json");
    assertEquals(findings.map((finding) => finding.rule), ["private-address"], value);
  }
  assertEquals(scanText(`endpoint: "https://[2001:db8::1]/mcp"`, "surface.json"), []);
  for (const entry of IPV6_DOCUMENTATION_PREFIXES) {
    const value = `${entry.groups}::1`;
    assertEquals(scanText(`endpoint: "https://[${value}]/mcp"`, "surface.json"), [], value);
  }
});

Deno.test("a single-label host is flagged because public DNS requires a dot", () => {
  const findings = scanText(`entry: "https://${SINGLE_LABEL_HOST}:8788/docs"`, "surface.json");
  assertEquals(findings.map((finding) => finding.rule), ["single-label-host"]);
  assertEquals(scanText(`entry: "https://mcp.example.invalid/sse"`, "surface.json"), []);
  assertEquals(scanText(`entry: "http://localhost:8788/docs"`, "surface.json"), []);
  assertEquals(scanText(`entry: "http://${LOOPBACK}:8788/docs"`, "surface.json"), []);
});

Deno.test("the documented placeholder hostnames stay usable in fixtures", () => {
  for (const entry of ALLOWED_INTERNAL_LABELS) {
    const findings = scanText(`entry: "http://${entry.label}/docs"`, "fixtures.ts");
    assertEquals(findings, [], entry.label);
  }
});

Deno.test("a variable or placeholder authority is not a host literal", () => {
  for (const authority of ["${HOST}", "$MCP_HOST", "$PORTICO_MCP_HOST"]) {
    assertEquals(scanText(`endpoint: "http://${authority}:8790/mcp"`, "config.ts"), []);
  }
  assertEquals(
    scanText(`endpoint: "http://${SINGLE_LABEL_HOST}:8788/docs"`, "config.ts").map((f) => f.rule),
    ["single-label-host"],
  );
});

Deno.test("redaction keeps a finding identifiable without repeating the value", () => {
  assertEquals(redact(RFC1918_TEN).includes(RFC1918_TEN), false);
  assert(redact(RFC1918_TEN).startsWith("10."), redact(RFC1918_TEN));
  assert(redact(ISSUER_TOKEN).startsWith("ghp_"), redact(ISSUER_TOKEN));
});

Deno.test("the tracked public surface is what the scan reads", async () => {
  const files = await listPublicSurfaceFiles();
  assert(files.includes("README.md"), "README.md is tracked and must be scanned");
  assert(!files.includes("dist/portico-portal"), "build output is not part of the public surface");
  assert(files.length > 150, `expected the whole tracked tree, saw ${files.length} files`);
});

Deno.test("no tracked file carries a credential or a live intranet coordinate", async () => {
  const { scanned, findings } = await scanRepository();
  assertEquals(findings.map(formatFinding), []);
  assert(scanned > 150, `expected to read the tracked tree, saw ${scanned} files`);
});

Deno.test("every exemption is justified and still needed", () => {
  for (const entry of ALLOWED_PRIVATE_ADDRESSES) {
    assert(entry.reason.trim().length > 0, `missing reason for ${entry.octets.join(".")}`);
  }
  for (const entry of ALLOWED_INTERNAL_LABELS) {
    assert(entry.reason.trim().length > 0, `missing reason for ${entry.label}`);
  }
  for (const entry of IPV6_DOCUMENTATION_PREFIXES) {
    assert(entry.reason.trim().length > 0, `missing reason for ${entry.groups}`);
  }
});

Deno.test("an exemption that no longer matches anything is removed, not kept", async () => {
  const files = await listPublicSurfaceFiles();
  const seen = new Set<string>();
  for (const file of files) {
    let text: string;
    try {
      text = await Deno.readTextFile(file);
    } catch {
      continue;
    }
    for (const finding of collectShapeFindings(text, file)) {
      if (finding.rule === "private-address") seen.add(finding.value);
      if (finding.rule === "single-label-host") seen.add(finding.value);
    }
  }
  for (const entry of ALLOWED_PRIVATE_ADDRESSES) {
    const value = entry.octets.join(".");
    assert(seen.has(value), `stale private-address exemption: ${value} no longer appears`);
  }
  for (const entry of ALLOWED_INTERNAL_LABELS) {
    assert(seen.has(entry.label), `stale single-label exemption: ${entry.label} no longer appears`);
  }
});
