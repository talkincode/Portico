import { CatalogError, ErrorCode } from "../catalog/mod.ts";

const LOOPBACK = new Set(["127.0.0.1", "localhost"]);

export function parseBindHostname(raw: string | undefined): string {
  const hostname = raw ?? "127.0.0.1";
  if (LOOPBACK.has(hostname)) return hostname;
  if (isRfc1918UnicastIPv4(hostname)) return hostname;
  throw new CatalogError(
    ErrorCode.USAGE,
    "PORTICO_BIND must be 127.0.0.1, localhost, or an RFC1918 unicast IPv4 address; 0.0.0.0, ::, and public addresses are refused",
  );
}

export function parseBindPort(raw: string | undefined, fallback: number): number {
  const port = Number(raw ?? String(fallback));
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    throw new CatalogError(ErrorCode.USAGE, "PORTICO_PORT must be an integer 0-65535");
  }
  return port;
}

export function readBind(
  env: Record<string, string | undefined>,
  defaultPort: number,
): { hostname: string; port: number } {
  return {
    hostname: parseBindHostname(env.PORTICO_BIND),
    port: parseBindPort(env.PORTICO_PORT, defaultPort),
  };
}

function isRfc1918UnicastIPv4(value: string): boolean {
  const octets = parseIPv4(value);
  if (!octets) return false;
  const [a, b] = octets;
  if (a === 10) return !isBlockEdge(octets, [10, 0, 0, 0], [10, 255, 255, 255]);
  if (a === 172 && b >= 16 && b <= 31) {
    return !isBlockEdge(octets, [172, 16, 0, 0], [172, 31, 255, 255]);
  }
  if (a === 192 && b === 168) {
    return !isBlockEdge(octets, [192, 168, 0, 0], [192, 168, 255, 255]);
  }
  return false;
}

function isBlockEdge(
  octets: [number, number, number, number],
  network: [number, number, number, number],
  broadcast: [number, number, number, number],
): boolean {
  return sameAddress(octets, network) || sameAddress(octets, broadcast);
}

function sameAddress(
  left: [number, number, number, number],
  right: [number, number, number, number],
): boolean {
  return left[0] === right[0] && left[1] === right[1] && left[2] === right[2] &&
    left[3] === right[3];
}

function parseIPv4(value: string): [number, number, number, number] | null {
  const parts = value.split(".");
  if (parts.length !== 4) return null;
  const octets: number[] = [];
  for (const part of parts) {
    if (!/^(0|[1-9]\d{0,2})$/.test(part)) return null;
    const n = Number(part);
    if (!Number.isInteger(n) || n < 0 || n > 255) return null;
    octets.push(n);
  }
  return octets as [number, number, number, number];
}
