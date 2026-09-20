/**
 * Security conclusions: what a human auditor decided about a registered
 * surface, or about one of the repository-wide contracts that has no surface,
 * kept apart from what a maintainer did to it.
 *
 * `AGENTS.md` and `docs/roadmap.md` split the two roles hard — maintainers
 * curate, humans audit — and require the maintenance trail and the audit
 * conclusions to live in separate stores so that a maintainer identity cannot
 * overwrite a verdict. Everything in this module exists to make that split
 * mechanical rather than aspirational:
 *
 * 1. Only a human auditor may record or read a conclusion. A maintainer, a
 *    reader and an anonymous caller are all refused, and an agent cannot even
 *    claim the auditor role: `identity grant` refuses `--kind agent --role
 *    auditor`, so a forged actor object is the only way in and it is refused
 *    here as well.
 * 2. The record is written to its own file, never to the catalog and never to
 *    the catalog change log. Recording an audit opinion is not a maintenance
 *    action and must not appear as one.
 * 3. Independence is per subject, mirroring the self-approval rule on the
 *    public boundary: an auditor who is also listed as a maintainer of the
 *    surface cannot certify it, but may still audit everything else.
 * 4. The store is append-only. There is no update and no delete, a duplicate
 *    id is refused outright rather than overwriting, and a later review of the
 *    same subject and scope adds a second record that leaves the first one
 *    readable — the history of "what the auditor used to believe" is part of
 *    the evidence, not something to tidy away.
 *
 * Reading is deliberately *not* part of `AuditService.list`: the audit timeline
 * is a projection of governance events, while a conclusion is an opinion about
 * them. Merging the two would let a verdict render as though it were an event.
 */

import {
  type Actor,
  type AgentSurface,
  assertActor,
  CatalogError,
  type CatalogService,
  containsPlaintextSecretValue,
  ErrorCode,
  SECRET_KEYS,
} from "../catalog/mod.ts";
import { serialize, writeJsonFile } from "../fs.ts";

/**
 * The security questions `AGENTS.md` and `docs/roadmap.md` assign to the human
 * auditor, named so a conclusion states which one it answers instead of leaving
 * that to prose. `permission_change` and `gateway_scope` are answered about the
 * surface they affected, so every surface conclusion has exactly one catalog
 * subject.
 */
export const SURFACE_SCOPES = [
  "public_boundary",
  "entry_target",
  "permission_change",
  "secret_leakage",
  "gateway_scope",
] as const;

/**
 * Two of the auditor's questions are about the repository as a whole rather
 * than about one registered surface: the Deno L0 runtime boundary and the
 * public-surface redaction rule. Both are rows in the acceptance matrix with a
 * `deno task` gate of their own, and neither has a catalog record that a
 * verdict could be attached to. Leaving them out would mean the two contracts
 * the repository enforces against itself are the only ones a human can never
 * sign off on, so they are subjects in their own namespace instead of pretend
 * records: a boundary id is not a legal surface id (catalog ids are lowercase
 * kebab-case, these carry a `boundary:` prefix), which keeps the two namespaces
 * from shadowing each other. Each contract declares the single scope that
 * answers it and the gate that produces its evidence.
 */
export const BOUNDARY_SUBJECTS: readonly BoundarySubject[] = [
  {
    id: "boundary:runtime-l0",
    scope: "runtime_l0",
    gate: "check:runtime-boundary",
  },
  {
    id: "boundary:public-redaction",
    scope: "secret_leakage",
    gate: "check:redaction",
  },
];

export const CONCLUSION_SCOPES = [...SURFACE_SCOPES, "runtime_l0"] as const;

export type ConclusionScope = (typeof CONCLUSION_SCOPES)[number];

export interface BoundarySubject {
  readonly id: string;
  /** The one question this contract answers. */
  readonly scope: ConclusionScope;
  /** The `deno task` that verifies the contract. */
  readonly gate: string;
}

/**
 * `flagged` is the direction that needs a reason: a finding with no note is not
 * actionable evidence. `cleared` may stand alone.
 */
export const CONCLUSION_VERDICTS = ["cleared", "flagged"] as const;

export type ConclusionVerdict = (typeof CONCLUSION_VERDICTS)[number];

export const CONCLUSION_NOTE_MAX = 500;
const SUBJECT_ID_MAX = 120;

const SCOPES = new Set<string>(CONCLUSION_SCOPES);
const SURFACE_SCOPES_SET = new Set<string>(SURFACE_SCOPES);
/**
 * Scopes only a repository boundary contract can answer. `secret_leakage` is
 * both a surface question and the redaction contract's, so it must stay legal
 * for a surface; `runtime_l0` is about the tree as a whole and has no surface
 * meaning.
 */
const BOUNDARY_ONLY_SCOPES = new Set<string>(
  BOUNDARY_SUBJECTS.map((item) => item.scope).filter((scope) => !SURFACE_SCOPES_SET.has(scope)),
);
const BOUNDARY_BY_ID = new Map<string, BoundarySubject>(
  BOUNDARY_SUBJECTS.map((item) => [item.id, item]),
);
const VERDICTS = new Set<string>(CONCLUSION_VERDICTS);
const ALLOWED_INPUT_KEYS = new Set(["id", "scope", "verdict", "note"]);
const ALLOWED_QUERY_KEYS = new Set(["subject", "scope", "verdict"]);

function findBoundary(id: string): BoundarySubject | undefined {
  return BOUNDARY_BY_ID.get(id);
}

export interface ConclusionInput {
  /** The catalog surface, or the repository boundary contract, this verdict is about. */
  id: string;
  scope: ConclusionScope;
  verdict: ConclusionVerdict;
  note?: string;
}

export interface AuditConclusion {
  id: string;
  subjectId: string;
  scope: ConclusionScope;
  verdict: ConclusionVerdict;
  auditorId: string;
  at: string;
  /**
   * The gate that answered a boundary contract, recorded with the verdict so
   * the evidence stays re-runnable instead of being inferred from today's
   * vocabulary. Absent on surface conclusions, which are answered by the
   * surface itself.
   */
  gate?: string;
  note?: string;
}

export interface ConclusionQuery {
  subject?: string;
  scope?: ConclusionScope;
  verdict?: ConclusionVerdict;
}

export interface ConclusionStore {
  /** Append-only. Implementations must refuse a duplicate id, never replace. */
  append(record: AuditConclusion): Promise<void>;
  list(): Promise<AuditConclusion[]>;
}

function cloneConclusion(record: AuditConclusion): AuditConclusion {
  return {
    id: record.id,
    subjectId: record.subjectId,
    scope: record.scope,
    verdict: record.verdict,
    auditorId: record.auditorId,
    at: record.at,
    ...(record.gate ? { gate: record.gate } : {}),
    ...(record.note ? { note: record.note } : {}),
  };
}

export class MemoryConclusionStore implements ConclusionStore {
  #conclusions: AuditConclusion[] = [];

  append(record: AuditConclusion): Promise<void> {
    if (this.#conclusions.some((item) => item.id === record.id)) {
      return Promise.reject(
        new CatalogError(ErrorCode.ALREADY_EXISTS, `conclusion '${record.id}' already exists`),
      );
    }
    this.#conclusions.push(cloneConclusion(record));
    return Promise.resolve();
  }

  list(): Promise<AuditConclusion[]> {
    return Promise.resolve(this.#conclusions.map(cloneConclusion));
  }
}

interface ConclusionFile {
  conclusions: AuditConclusion[];
}

export class FileConclusionStore implements ConclusionStore {
  constructor(private readonly path: string) {}

  append(record: AuditConclusion): Promise<void> {
    return serialize(this.path, () => this.#appendImpl(record));
  }

  async #appendImpl(record: AuditConclusion): Promise<void> {
    const file = await this.#load();
    if (file.conclusions.some((item) => item.id === record.id)) {
      throw new CatalogError(
        ErrorCode.ALREADY_EXISTS,
        `conclusion '${record.id}' already exists`,
      );
    }
    file.conclusions.push(cloneConclusion(record));
    await writeJsonFile(this.path, { conclusions: file.conclusions });
  }

  async list(): Promise<AuditConclusion[]> {
    const file = await this.#load();
    return file.conclusions.map(cloneConclusion);
  }

  async #load(): Promise<ConclusionFile> {
    try {
      const text = await Deno.readTextFile(this.path);
      const parsed = JSON.parse(text) as Partial<ConclusionFile>;
      if (!parsed || !Array.isArray(parsed.conclusions)) {
        throw new Error(`conclusion file is corrupt: ${this.path}`);
      }
      return { conclusions: parsed.conclusions.map(cloneConclusion) };
    } catch (error) {
      if (error instanceof Deno.errors.NotFound) {
        return { conclusions: [] };
      }
      throw error;
    }
  }
}

export class ConclusionService {
  constructor(
    private readonly store: ConclusionStore,
    private readonly catalog: CatalogService,
  ) {}

  async record(actor: Actor, input: ConclusionInput): Promise<AuditConclusion> {
    assertActor(actor);
    assertAuditor(actor, "record");
    const parsed = parseConclusionInput(input);

    const boundary = findBoundary(parsed.id);
    let gate: string | undefined;
    if (boundary) {
      // A boundary contract is not a catalog record: there is no surface to
      // read and no maintainer list to conflict with, so the same independence
      // rule that guards a surface has nothing to check here. What is checked
      // is that the verdict answers the question the contract declares.
      if (parsed.scope !== boundary.scope) {
        throw new CatalogError(
          ErrorCode.INVALID_INPUT,
          `'${boundary.id}' answers '${boundary.scope}', not '${parsed.scope}'`,
        );
      }
      gate = boundary.gate;
    } else {
      // The subject must exist in the catalog. A verdict about nothing is not
      // evidence, and `catalog.get` applies the same visibility rule as every
      // other read so a conclusion cannot name a surface the actor cannot see.
      const subject = await this.catalog.get(actor, parsed.id);
      if (BOUNDARY_ONLY_SCOPES.has(parsed.scope)) {
        throw new CatalogError(
          ErrorCode.INVALID_INPUT,
          `scope '${parsed.scope}' answers a repository boundary, not surface '${subject.id}'`,
        );
      }
      assertIndependent(actor, subject);
    }

    const at = new Date().toISOString();
    const record: AuditConclusion = {
      id: conclusionId(parsed.id, parsed.scope, at),
      subjectId: parsed.id,
      scope: parsed.scope,
      verdict: parsed.verdict,
      auditorId: actor.id,
      at,
      ...(gate ? { gate } : {}),
      ...(parsed.note ? { note: parsed.note } : {}),
    };
    await this.store.append(record);
    return cloneConclusion(record);
  }

  async list(actor: Actor, query: ConclusionQuery = {}): Promise<AuditConclusion[]> {
    assertActor(actor);
    assertAuditor(actor, "read");
    // Re-validate rather than trusting the caller: the HTTP entrances build
    // this from raw query strings, and the role check must not be the only
    // thing standing between a malformed filter and the store.
    const parsed = parseConclusionQuery(query);
    return applyConclusionQuery(await this.store.list(), parsed);
  }
}

export function parseConclusionQuery(raw: unknown): ConclusionQuery {
  if (raw === undefined || raw === null) return {};
  if (typeof raw !== "object" || Array.isArray(raw)) {
    throw new CatalogError(ErrorCode.INVALID_INPUT, "conclusion query must be an object");
  }
  const query = raw as Record<string, unknown>;
  for (const key of Object.keys(query)) {
    if (!ALLOWED_QUERY_KEYS.has(key)) {
      throw new CatalogError(ErrorCode.INVALID_INPUT, `unknown filter '${key}'`);
    }
  }

  const parsed: ConclusionQuery = {};
  const subject = query.subject;
  if (subject !== undefined) {
    if (typeof subject !== "string" || !subject.trim()) {
      throw new CatalogError(ErrorCode.INVALID_INPUT, "subject filter must be a non-empty string");
    }
    parsed.subject = subject.trim();
  }
  const scope = query.scope;
  if (scope !== undefined) {
    if (typeof scope !== "string" || !SCOPES.has(scope)) {
      throw new CatalogError(
        ErrorCode.INVALID_INPUT,
        `scope must be one of ${CONCLUSION_SCOPES.join(", ")}`,
      );
    }
    parsed.scope = scope as ConclusionScope;
  }
  const verdict = query.verdict;
  if (verdict !== undefined) {
    if (typeof verdict !== "string" || !VERDICTS.has(verdict)) {
      throw new CatalogError(
        ErrorCode.INVALID_INPUT,
        `verdict must be one of ${CONCLUSION_VERDICTS.join(", ")}`,
      );
    }
    parsed.verdict = verdict as ConclusionVerdict;
  }
  return parsed;
}

export function applyConclusionQuery(
  records: AuditConclusion[],
  query: ConclusionQuery,
): AuditConclusion[] {
  const parsed = parseConclusionQuery(query);
  return records
    .filter((record) => (parsed.subject ? record.subjectId === parsed.subject : true))
    .filter((record) => (parsed.scope ? record.scope === parsed.scope : true))
    .filter((record) => (parsed.verdict ? record.verdict === parsed.verdict : true))
    .map(cloneConclusion);
}

function assertAuditor(actor: Actor, verb: string): void {
  if (actor.kind !== "human" || actor.role !== "auditor") {
    throw new CatalogError(
      ErrorCode.FORBIDDEN,
      `only a human auditor may ${verb} a security conclusion`,
    );
  }
}

/**
 * Independence from the maintenance trail. `docs/roadmap.md` forbids a
 * maintainer from approving its own public release; the same conflict of
 * interest applies when the auditor is the maintainer of the subject, so the
 * verdict is refused and recorded nowhere.
 */
function assertIndependent(actor: Actor, subject: AgentSurface): void {
  if (subject.maintainers.some((item) => item.id === actor.id)) {
    throw new CatalogError(
      ErrorCode.SELF_AUDIT,
      `'${actor.id}' maintains surface '${subject.id}' and cannot conclude on it`,
    );
  }
}

function parseConclusionInput(input: unknown): {
  id: string;
  scope: ConclusionScope;
  verdict: ConclusionVerdict;
  note?: string;
} {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new CatalogError(ErrorCode.INVALID_INPUT, "conclusion payload must be an object");
  }
  const payload = input as Record<string, unknown>;
  for (const key of Object.keys(payload)) {
    if (SECRET_KEYS.has(key)) {
      throw new CatalogError(
        ErrorCode.INVALID_INPUT,
        "plaintext secret fields are not allowed; store a reference instead",
      );
    }
    if (!ALLOWED_INPUT_KEYS.has(key)) {
      throw new CatalogError(ErrorCode.INVALID_INPUT, `unknown or forbidden field '${key}'`);
    }
  }

  const id = payload.id;
  if (typeof id !== "string" || !id.trim() || id.trim().length > SUBJECT_ID_MAX) {
    throw new CatalogError(ErrorCode.INVALID_INPUT, "id must be a non-empty string");
  }

  const scope = payload.scope;
  if (typeof scope !== "string" || !SCOPES.has(scope)) {
    throw new CatalogError(
      ErrorCode.INVALID_INPUT,
      `scope must be one of ${CONCLUSION_SCOPES.join(", ")}`,
    );
  }

  const verdict = payload.verdict;
  if (typeof verdict !== "string" || !VERDICTS.has(verdict)) {
    throw new CatalogError(
      ErrorCode.INVALID_INPUT,
      `verdict must be one of ${CONCLUSION_VERDICTS.join(", ")}`,
    );
  }

  const note = parseConclusionNote(payload.note);
  if (verdict === "flagged" && !note) {
    throw new CatalogError(
      ErrorCode.INVALID_INPUT,
      "a flagged verdict must carry a note describing the finding",
    );
  }

  return {
    id: id.trim(),
    scope: scope as ConclusionScope,
    verdict: verdict as ConclusionVerdict,
    ...(note ? { note } : {}),
  };
}

function parseConclusionNote(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string") {
    throw new CatalogError(ErrorCode.INVALID_INPUT, "note must be a string");
  }
  const text = value.trim();
  if (!text) {
    throw new CatalogError(ErrorCode.INVALID_INPUT, "note is required");
  }
  if (text.length > CONCLUSION_NOTE_MAX) {
    throw new CatalogError(ErrorCode.INVALID_INPUT, "note is too long");
  }
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (code <= 0x1f || code === 0x7f) {
      throw new CatalogError(
        ErrorCode.INVALID_INPUT,
        "note must not contain control characters",
      );
    }
  }
  // `密钥只引用，不落明文`: an auditor naming the credential it found is the
  // easiest way for a live token to end up stored, so the note is scanned by
  // the same scanner the catalog uses instead of a second, weaker copy.
  if (containsPlaintextSecretValue(text)) {
    throw new CatalogError(
      ErrorCode.INVALID_INPUT,
      "note must not contain a plaintext secret; store a reference instead",
    );
  }
  return text;
}

function conclusionId(subjectId: string, scope: ConclusionScope, at: string): string {
  return `ccl-${subjectId}-${scope}-${stamp(at)}-${nextSequence()}`;
}

function stamp(at: string): string {
  return at.replaceAll(/[^0-9]/g, "");
}

/**
 * Millisecond timestamps are not fine enough to keep ids unique: the same
 * auditor may review the same scope twice inside one millisecond. The sequence
 * keeps ids unique within the process, and the store still refuses a duplicate
 * outright, so a cross-process clash fails loudly instead of overwriting a
 * verdict.
 */
let idSequence = 0;

function nextSequence(): string {
  idSequence += 1;
  return idSequence.toString(36);
}
