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
 */

/** Directory containing `path`, or null when there is nothing to create. */
function parentDir(path: string): string | null {
  const index = path.lastIndexOf("/");
  if (index <= 0) return null;
  return path.slice(0, index);
}

export async function writeJsonFile(path: string, value: unknown): Promise<void> {
  const dir = parentDir(path);
  if (dir) {
    await Deno.mkdir(dir, { recursive: true });
  }
  const tmp = `${path}.tmp`;
  await Deno.writeTextFile(tmp, `${JSON.stringify(value, null, 2)}\n`);
  await Deno.rename(tmp, path);
}
