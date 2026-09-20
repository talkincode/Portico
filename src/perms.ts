/**
 * The permission split, declared once.
 *
 * This is a governance property, not a packaging detail: the Portal and the
 * MCP server serve governance state and must never be able to rewrite it, the
 * Gateway needs write access only for its own access-audit file, and nothing
 * may bind anything but the address the operator configured. `deno task up`,
 * `deno task build`, and the process tests all read these same functions so
 * they cannot drift apart.
 *
 * The bind address is a parameter rather than a constant because the intranet
 * deployment binds an RFC1918 address (`src/runtime/bind.ts` is the one place
 * that decides which addresses are acceptable). Baked-in permissions cannot be
 * widened at runtime, so an artifact built for loopback will refuse an intranet
 * bind — build with `PORTICO_BIND` set to the real address.
 */

export const LOOPBACK_HOSTNAME = "127.0.0.1";

/** Loopback is always allowed; a non-loopback bind address is added explicitly. */
export function netAllow(hostname: string): string {
  if (hostname === LOOPBACK_HOSTNAME || hostname === "localhost") {
    return `--allow-net=${LOOPBACK_HOSTNAME}`;
  }
  return `--allow-net=${LOOPBACK_HOSTNAME},${hostname}`;
}

export function cliPerms(): readonly string[] {
  return ["--allow-read", "--allow-write", "--allow-env"];
}

/** Both read-only HTTP entrances share one profile: no `--allow-write`. */
export function readOnlyHttpPerms(hostname: string = LOOPBACK_HOSTNAME): readonly string[] {
  return ["--allow-read", "--allow-env", netAllow(hostname)];
}

export function gatewayPerms(hostname: string = LOOPBACK_HOSTNAME): readonly string[] {
  return ["--allow-read", "--allow-write", "--allow-env", netAllow(hostname)];
}

/**
 * Review reads the roster and catalog, creates browser sessions, and atomically
 * updates catalog decisions. It never writes identities: granting/revoking
 * identities and issuing credentials remain CLI-only trust-root operations.
 */
export function reviewPerms(
  hostname: string = LOOPBACK_HOSTNAME,
  paths?: { catalog: string; identities: string; sessions: string },
): readonly string[] {
  const read = paths ? `--allow-read=${paths.catalog},${paths.identities},${paths.sessions}` : "--allow-read";
  const write = paths
    ? `--allow-write=${paths.catalog},${paths.catalog}.tmp,${paths.sessions},${paths.sessions}.tmp`
    : "--allow-write";
  return [read, write, "--allow-env", netAllow(hostname)];
}

export const CLI_PERMS: readonly string[] = cliPerms();
export const PORTAL_PERMS: readonly string[] = readOnlyHttpPerms();
export const MCP_PERMS: readonly string[] = readOnlyHttpPerms();
export const GATEWAY_PERMS: readonly string[] = gatewayPerms();
