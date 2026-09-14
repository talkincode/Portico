/**
 * Shared on-disk JSON persistence for every Portico store.
 *
 * Two properties matter for a system that must be startable on an empty
 * machine and readable by a human auditor afterwards:
 *
 * 1. The parent directory is created on demand. Every documented first run
 *    (`--identities ./data/identities.json`) writes into `data/`, which does
 *    not exist on a fresh checkout. Without this, the very first README
 *    command failed with a raw OS error.
 * 2. The write is atomic: a sibling temp file is renamed into place, so a
 *    crash can never leave a half-written governance record.
 *
 * The directory is only created when it is genuinely missing. `Deno.mkdir`
 * needs write access to the *directory*, and the deployed services deliberately
 * grant write access to a single file and its temp sibling rather than to the
 * whole data directory — an unconditional `mkdir` turned every Gateway audit
 * append into `Requires write access to "/app/data"`, which surfaced as a 500
 * on the deny path instead of the correct 404. Check first, create only if
 * absent, and otherwise let the write report its own precise error.
 */

/** Directory containing `path`, or null when there is nothing to create. */
function parentDir(path: string): string | null {
  const index = path.lastIndexOf("/");
  if (index <= 0) return null;
  return path.slice(0, index);
}

async function ensureParentDir(path: string): Promise<void> {
  const dir = parentDir(path);
  if (!dir) return;
  try {
    await Deno.stat(dir);
    return;
  } catch (error) {
    if (!(error instanceof Deno.errors.NotFound)) {
      // Cannot even tell: assume it exists and let the write below report the
      // real problem with its own, more precise message.
      return;
    }
  }
  await Deno.mkdir(dir, { recursive: true });
}

export async function writeJsonFile(path: string, value: unknown): Promise<void> {
  await ensureParentDir(path);
  const tmp = `${path}.tmp`;
  await Deno.writeTextFile(tmp, `${JSON.stringify(value, null, 2)}\n`);
  await Deno.rename(tmp, path);
}

/**
 * Serializes one read-modify-write of `path` at a time, per process.
 *
 * Every store is a whole-file read → mutate → write, and `await` interleaves:
 * two concurrent calls both load, both mutate their own copy, and the second
 * write silently discards the first. The Gateway does exactly this — it appends
 * to its access audit on every request, so concurrent requests lost audit
 * records. Losing an audit record is a governance failure, not a data glitch.
 *
 * The temp file keeps its plain `<path>.tmp` name on purpose: the deployment
 * grants write access to exactly that file, so a unique suffix would be
 * refused. Cross-process writers are still unsynchronized; each file has one
 * writer process by design (see `docs/roadmap.md`).
 */
const writeChains = new Map<string, Promise<unknown>>();

export function serialize<T>(path: string, task: () => Promise<T>): Promise<T> {
  const previous = writeChains.get(path) ?? Promise.resolve();
  const result = previous.then(task, task);
  // The chain must continue even when a task rejects.
  writeChains.set(path, result.then(() => {}, () => {}));
  return result;
}
