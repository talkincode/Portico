/**
 * The CI workflow is a contract, not a convenience: it is the only place where
 * "the branch is green" is decided. Two properties matter enough to be pinned
 * here rather than left to whoever edits the YAML next.
 *
 * First, the gate set. A red branch has to mean something specific, so the
 * check job must actually run the gates: formatting, lint, type check, tests
 * and build. A contract that can be satisfied by deleting a gate is worthless,
 * so `expectedGateSteps` names them and the test asserts every name is present.
 *
 * Second, independence. Steps after the first failing one are skipped by
 * default, which turns one broken gate into an unknown number of unexamined
 * ones: a formatting drift stops the job before it ever compiles the code, and
 * the report says "fmt failed" while saying nothing about whether the revision
 * is otherwise sound. The failure is real but the diagnosis is truncated, and
 * the next person has to fix `fmt`, push, and wait again to discover the next
 * problem. These are text-level assertions over the workflow because that is
 * the artifact that carries the semantics; the test reads the same bytes
 * Actions reads.
 *
 * A gate therefore has to opt out of the implicit "skip if something failed"
 * rule by naming an `if:` that runs regardless. `always()` and `!cancelled()`
 * are accepted, including when combined with a further condition such as a
 * matrix filter, so a genuinely conditional step can still be written as
 * `if: always() && matrix.slow`. What is rejected is a gate that is silently
 * dependent on everything before it succeeding.
 */

export interface WorkflowStep {
  /** `name:` when the step has one, otherwise its `uses:` coordinate. */
  name: string;
  line: number;
  if?: string;
  run?: string;
  uses?: string;
}

export interface GateFinding {
  step: string;
  line: number;
  detail: string;
}

function indentOf(line: string): number {
  return line.length - line.trimStart().length;
}

function unquote(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length >= 2) {
    const first = trimmed[0];
    const last = trimmed[trimmed.length - 1];
    if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
      return trimmed.slice(1, -1);
    }
  }
  return trimmed;
}

/**
 * Reads the `steps:` list of a workflow. Only the first `steps:` block is
 * parsed: the repository ships one job, and a second job would be a new
 * decision that deserves its own reading rather than a silent one.
 */
export function parseSteps(workflow: string): WorkflowStep[] {
  const lines = workflow.split("\n");
  const stepsIndex = lines.findIndex((line) => line.trim() === "steps:");
  if (stepsIndex < 0) return [];

  const blockIndent = indentOf(lines[stepsIndex]);
  const dashIndent = blockIndent + 2;
  const keyIndent = dashIndent + 2;

  const steps: WorkflowStep[] = [];
  let keys: string[] = [];
  let startLine = 0;
  let inStep = false;

  const flush = () => {
    if (!inStep) return;
    const step: WorkflowStep = { name: "", line: startLine };
    for (const key of keys) {
      const separator = key.indexOf(":");
      if (separator < 0) continue;
      const name = key.slice(0, separator).trim();
      const value = unquote(key.slice(separator + 1));
      if (name === "name") step.name = value;
      else if (name === "if") step.if = value;
      else if (name === "run") step.run = value;
      else if (name === "uses") step.uses = value;
    }
    if (step.name === "") step.name = step.uses ?? "(unnamed step)";
    steps.push(step);
    keys = [];
  };

  for (let index = stepsIndex + 1; index < lines.length; index++) {
    const line = lines[index];
    if (line.trim() === "") continue;
    const indent = indentOf(line);
    if (indent <= blockIndent) break;

    if (indent === dashIndent && line.trimStart().startsWith("- ")) {
      flush();
      inStep = true;
      startLine = index + 1;
      keys.push(line.trimStart().slice(2));
      continue;
    }
    if (!inStep) continue;
    // Only the step's own keys count. A nested key such as the `deno-version`
    // under `with:` sits deeper and must not be mistaken for a gate property.
    if (indent === keyIndent) keys.push(line.trim());
  }
  flush();
  return steps;
}

const GATES_THAT_RUN_ANYWAY = /(?:^|[^a-zA-Z_])always\(\)|(?:^|[^a-zA-Z_])!\s*cancelled\(\)/;

function runsWhenEarlierFailed(step: WorkflowStep): boolean {
  return step.if !== undefined && GATES_THAT_RUN_ANYWAY.test(step.if);
}

/**
 * Every command step must run even when a previous step failed. Steps that are
 * skipped still leave the job red, so this cannot hide a failure; it only stops
 * one failure from withholding the verdict on everything after it.
 */
export function scanGateIndependence(workflow: string): GateFinding[] {
  const findings: GateFinding[] = [];
  const gates = parseSteps(workflow).filter((step) => step.run !== undefined);
  for (const gate of gates.slice(1)) {
    if (runsWhenEarlierFailed(gate)) continue;
    findings.push({
      step: gate.name,
      line: gate.line,
      detail: (gate.if === undefined
        ? "no `if:`; the step is skipped once an earlier step fails"
        : `\`if: ${gate.if}\`; the step still stops when an earlier step fails`) +
        " - add `if: always()` so one broken gate cannot hide the others",
    });
  }
  return findings;
}

/** The gates the check job must keep running; removing one must fail the test. */
export const expectedGateSteps = ["fmt", "lint", "check", "test", "build"] as const;

/**
 * The command steps of the check job, in order. The order matters: independence
 * is asserted for every gate after the first, so inserting one silently would
 * move the boundary of what is allowed to be skipped.
 */
export function gateSteps(workflow: string): string[] {
  return parseSteps(workflow).filter((step) => step.run !== undefined).map((step) => step.name);
}
