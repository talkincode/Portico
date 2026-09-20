import { assert, assertEquals } from "./assert.ts";
import { expectedGateSteps, gateSteps, parseSteps, scanGateIndependence } from "./ci_gates.ts";

const ROOT = new URL("../", import.meta.url).pathname;
const WORKFLOW = `${ROOT}.github/workflows/ci.yml`;

const WORKFLOW_WITH = (gateConditions: string): string =>
  [
    "jobs:",
    "  check:",
    "    runs-on: ubuntu-latest",
    "    steps:",
    "      - uses: actions/checkout@v5",
    "      - uses: denoland/setup-deno@v2",
    "        with:",
    '          deno-version: "2.9.6"',
    "      - name: fmt",
    "        run: deno fmt --check",
    "      - name: lint",
    gateConditions,
    "        run: deno task lint",
    "",
  ].join("\n");

Deno.test("CI: the check job still runs the whole gate set", async () => {
  const workflow = await Deno.readTextFile(WORKFLOW);
  assertEquals(
    gateSteps(workflow),
    [...expectedGateSteps],
    "a red branch has to name a specific promise; deleting a gate would make the contract vacuous, and adding one silently would move what is allowed to be skipped",
  );
});

Deno.test("CI: every gate runs even when an earlier gate fails", async () => {
  const workflow = await Deno.readTextFile(WORKFLOW);
  assertEquals(
    scanGateIndependence(workflow).map((finding) => `${finding.step}: ${finding.detail}`),
    [],
    "steps after a failing step are skipped by default, so one broken gate would hide the verdict on the rest",
  );
});

Deno.test("CI: a gate without an `if` is reported", () => {
  const findings = scanGateIndependence(WORKFLOW_WITH("        run: deno task lint"));
  // The run line above belongs to `lint`; the injected gate has no `if:` at all.
  assert(findings.length >= 1, "a gate that is skipped after a failure must be reported");
  assert(
    findings.some((finding) => finding.step === "lint" && finding.detail.includes("no `if:`")),
    `expected lint to be reported, got ${JSON.stringify(findings)}`,
  );
});

Deno.test("CI: a gate gated on success is reported", () => {
  const findings = scanGateIndependence(WORKFLOW_WITH("        if: success()"));
  assert(
    findings.some((finding) => finding.step === "lint" && finding.detail.includes("success()")),
    `expected success() to be rejected, got ${JSON.stringify(findings)}`,
  );
  // `failure()` is the mirror image and is just as wrong: a gate that only runs
  // after something else broke says nothing about a healthy revision.
  const mirrored = scanGateIndependence(WORKFLOW_WITH("        if: failure()"));
  assert(
    mirrored.some((finding) => finding.step === "lint"),
    "a gate that only runs after a failure must be reported",
  );
});

Deno.test("CI: naming a condition that runs regardless is accepted", () => {
  for (
    const accepted of [
      "        if: always()",
      "        if: ${{ always() }}",
      "        if: always() && matrix.slow",
      "        if: '!cancelled()'",
    ]
  ) {
    const findings = scanGateIndependence(WORKFLOW_WITH(accepted));
    assertEquals(
      findings.filter((finding) => finding.step === "lint"),
      [],
      `${accepted.trim()} must be accepted`,
    );
  }
});

Deno.test("CI: only the step's own keys describe the step", () => {
  const steps = parseSteps(WORKFLOW_WITH("        if: always()"));
  const lint = steps.find((step) => step.name === "lint");
  if (!lint) throw new Error(`the lint gate must be parsed, got ${JSON.stringify(steps)}`);
  assertEquals(lint.if, "always()");
  // `deno-version` lives under `with:` two levels deeper than the step's keys;
  // reading it as a property of a step would let a nested value decide whether
  // a gate counts as independent.
  const setup = steps.find((step) => step.name === "denoland/setup-deno@v2");
  if (!setup) {
    throw new Error(`the setup step must be named after its uses coordinate, got ${steps.length}`);
  }
  assertEquals(setup.run, undefined);
  assertEquals(setup.if, undefined);
});
