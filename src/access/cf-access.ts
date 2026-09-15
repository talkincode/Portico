/**
 * Cloudflare Access JWT verification for the Portal browser surface.
 *
 * This is not a second writable identity and not an IdP. CLI, Gateway and MCP
 * must keep using Portico sessions. A verified email is only a mapping key
 * into the local roster; miss or any verification failure is anonymous.
 *
 * Fail-closed: never throw into a 500 that opens the internal plane, never
 * trust `Cf-Access-Authenticated-User-Email`, never write identities or sessions.
 */

const EMAIL_PATTERN = /^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/;
const TEAM_PATTERN = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/;
const MAX_AUD_LENGTH = 200;
const MAX_JWT_LENGTH = 16_384;

export interface JwkRsa {
  kid: string;
  kty: "RSA";
  alg?: string;
  use?: string;
  n: string;
  e: string;
}

export interface Jwks {
  keys: JwkRsa[];
}

export interface CfAccessConfig {
  enabled: true;
  team: string;
  aud: string;
  issuer: string;
  jwksUrl: string;
}

export type CfAccessSettings = { enabled: false } | CfAccessConfig;

export interface VerifyCfAccessDeps {
  fetchJwks: (url: string) => Promise<Jwks>;
  now?: () => Date;
}

export interface VerifiedCfAccess {
  email: string;
}

export function parseCfAccessEnv(
  env: Record<string, string | undefined>,
): CfAccessSettings {
  if (!isEnabledFlag(env.PORTICO_CF_ACCESS_ENABLED)) {
    return { enabled: false };
  }
  const team = (env.PORTICO_CF_ACCESS_TEAM ?? "").trim().toLowerCase();
  const aud = (env.PORTICO_CF_ACCESS_AUD ?? "").trim();
  if (!TEAM_PATTERN.test(team) || !aud || aud.length > MAX_AUD_LENGTH || /\s/.test(aud)) {
    return { enabled: false };
  }
  const issuer = `https://${team}.cloudflareaccess.com`;
  const defaultJwks = `${issuer}/cdn-cgi/access/certs`;
  const override = env.PORTICO_CF_ACCESS_JWKS_URL?.trim();
  const jwksUrl = override ? override : defaultJwks;
  if (!jwksUrlAllowed(jwksUrl, team)) {
    return { enabled: false };
  }
  return { enabled: true, team, aud, issuer, jwksUrl };
}

export async function verifyCfAccessJwt(
  token: string,
  config: CfAccessConfig,
  deps: VerifyCfAccessDeps,
): Promise<VerifiedCfAccess | null> {
  try {
    if (!config.enabled) return null;
    if (typeof token !== "string" || token.length === 0 || token.length > MAX_JWT_LENGTH) {
      return null;
    }
    const parts = token.split(".");
    if (parts.length !== 3) return null;
    const [headB64, payloadB64, sigB64] = parts;
    if (!headB64 || !payloadB64 || !sigB64) return null;

    const header = decodeJson(headB64);
    if (!header || header.alg !== "RS256" || typeof header.kid !== "string" || !header.kid) {
      return null;
    }
    if (header.typ !== undefined && header.typ !== "JWT") return null;

    const payload = decodeJson(payloadB64);
    if (!payload) return null;

    const now = Math.floor((deps.now?.() ?? new Date()).getTime() / 1000);
    if (!audienceMatches(payload.aud, config.aud)) return null;
    if (payload.iss !== config.issuer) return null;
    if (typeof payload.exp !== "number" || !Number.isFinite(payload.exp) || payload.exp <= now) {
      return null;
    }
    if (
      payload.nbf !== undefined &&
      (typeof payload.nbf !== "number" || !Number.isFinite(payload.nbf) || payload.nbf > now)
    ) {
      return null;
    }

    const email = normalizeEmail(payload.email);
    if (!email) return null;

    const jwks = await deps.fetchJwks(config.jwksUrl);
    const jwk = jwks.keys.find((key) =>
      key.kid === header.kid && key.kty === "RSA" && typeof key.n === "string" &&
      typeof key.e === "string"
    );
    if (!jwk) return null;

    const key = await crypto.subtle.importKey(
      "jwk",
      { kty: "RSA", n: jwk.n, e: jwk.e, alg: "RS256", ext: true },
      { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
      false,
      ["verify"],
    );
    const signed = new TextEncoder().encode(`${headB64}.${payloadB64}`);
    const signature = decodeB64Url(sigB64);
    if (!signature) return null;
    const ok = await crypto.subtle.verify(
      "RSASSA-PKCS1-v1_5",
      key,
      signature.slice(),
      signed,
    );
    if (!ok) return null;
    return { email };
  } catch {
    return null;
  }
}

export async function fetchJwksDocument(url: string): Promise<Jwks> {
  const response = await fetch(url, { redirect: "error" });
  if (!response.ok) throw new Error("jwks unreachable");
  const body: unknown = await response.json();
  if (!body || typeof body !== "object" || !("keys" in body)) {
    throw new Error("jwks invalid");
  }
  const keys = (body as { keys: unknown }).keys;
  if (!Array.isArray(keys)) throw new Error("jwks invalid");
  return { keys: keys as Jwks["keys"] };
}

/** In-process verifier with a short JWKS cache. Portal-only. */
export class CfAccessVerifier {
  #cached: Jwks | null = null;
  #cachedAt = 0;

  constructor(
    private readonly config: CfAccessConfig,
    private readonly fetchJwks: (url: string) => Promise<Jwks> = fetchJwksDocument,
    private readonly ttlMs = 10 * 60 * 1000,
  ) {}

  async verify(assertion: string): Promise<VerifiedCfAccess | null> {
    return await verifyCfAccessJwt(assertion, this.config, {
      fetchJwks: (url) => this.#load(url),
    });
  }

  async #load(url: string): Promise<Jwks> {
    const now = Date.now();
    if (this.#cached && now - this.#cachedAt < this.ttlMs) return this.#cached;
    const jwks = await this.fetchJwks(url);
    this.#cached = jwks;
    this.#cachedAt = now;
    return jwks;
  }
}

function isEnabledFlag(value: string | undefined): boolean {
  if (!value) return false;
  return ["1", "true", "yes", "on"].includes(value.trim().toLowerCase());
}

function jwksUrlAllowed(url: string, team: string): boolean {
  try {
    const parsed = new URL(url);
    if (parsed.username || parsed.password || parsed.hash) return false;
    if (parsed.protocol === "http:") {
      return parsed.hostname === "127.0.0.1" && parsed.pathname.length > 0;
    }
    if (parsed.protocol !== "https:") return false;
    return parsed.hostname === `${team}.cloudflareaccess.com` &&
      parsed.pathname === "/cdn-cgi/access/certs";
  } catch {
    return false;
  }
}

function audienceMatches(aud: unknown, expected: string): boolean {
  if (typeof aud === "string") return aud === expected;
  if (Array.isArray(aud)) return aud.includes(expected);
  return false;
}

function normalizeEmail(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const email = value.trim().toLowerCase();
  if (!EMAIL_PATTERN.test(email) || email.length > 254) return null;
  return email;
}

function decodeJson(input: string): Record<string, unknown> | null {
  const bytes = decodeB64Url(input);
  if (!bytes) return null;
  try {
    const parsed = JSON.parse(new TextDecoder().decode(bytes));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    return parsed as Record<string, unknown>;
  } catch {
    return null;
  }
}

function decodeB64Url(input: string): Uint8Array | null {
  if (!/^[A-Za-z0-9_-]+$/.test(input)) return null;
  const padded = input.replaceAll("-", "+").replaceAll("_", "/") +
    "=".repeat((4 - (input.length % 4)) % 4);
  try {
    const bin = atob(padded);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  } catch {
    return null;
  }
}
