import { assert, assertEquals } from "./assert.ts";
import {
  type CfAccessConfig,
  type Jwks,
  parseCfAccessEnv,
  verifyCfAccessJwt,
} from "../src/access/cf-access.ts";

const TEAM = "example";
const AUD = "test-audience-tag";
const ISSUER = "https://example.cloudflareaccess.com";
const EMAIL = "Reader@example.invalid";

interface KeyPair {
  kid: string;
  privateKey: CryptoKey;
  jwks: Jwks;
}

async function generateRs256(): Promise<KeyPair> {
  const kid = "test-kid";
  const pair = await crypto.subtle.generateKey(
    {
      name: "RSASSA-PKCS1-v1_5",
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: "SHA-256",
    },
    true,
    ["sign", "verify"],
  );
  const publicJwk = await crypto.subtle.exportKey("jwk", pair.publicKey);
  return {
    kid,
    privateKey: pair.privateKey,
    jwks: {
      keys: [{
        kid,
        kty: "RSA",
        alg: "RS256",
        use: "sig",
        n: publicJwk.n!,
        e: publicJwk.e!,
      }],
    },
  };
}

function b64url(data: Uint8Array | string): string {
  const bytes = typeof data === "string" ? new TextEncoder().encode(data) : data;
  let bin = "";
  for (const byte of bytes) bin += String.fromCharCode(byte);
  return btoa(bin).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

async function mintJwt(
  privateKey: CryptoKey,
  header: Record<string, unknown>,
  payload: Record<string, unknown>,
): Promise<string> {
  const head = b64url(JSON.stringify(header));
  const body = b64url(JSON.stringify(payload));
  const data = new TextEncoder().encode(`${head}.${body}`);
  const signature = new Uint8Array(
    await crypto.subtle.sign("RSASSA-PKCS1-v1_5", privateKey, data),
  );
  return `${head}.${body}.${b64url(signature)}`;
}

function config(): CfAccessConfig {
  return {
    enabled: true,
    team: TEAM,
    aud: AUD,
    issuer: ISSUER,
    jwksUrl: "http://127.0.0.1:9/certs",
  };
}

function claims(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const now = Math.floor(Date.now() / 1000);
  return {
    aud: AUD,
    iss: ISSUER,
    exp: now + 600,
    iat: now - 10,
    email: EMAIL,
    ...overrides,
  };
}

Deno.test("CF Access env is disabled unless explicitly enabled with team and aud", () => {
  assertEquals(parseCfAccessEnv({}).enabled, false);
  assertEquals(parseCfAccessEnv({ PORTICO_CF_ACCESS_ENABLED: "true" }).enabled, false);
  assertEquals(
    parseCfAccessEnv({
      PORTICO_CF_ACCESS_ENABLED: "true",
      PORTICO_CF_ACCESS_TEAM: TEAM,
    }).enabled,
    false,
  );
  const parsed = parseCfAccessEnv({
    PORTICO_CF_ACCESS_ENABLED: "true",
    PORTICO_CF_ACCESS_TEAM: TEAM,
    PORTICO_CF_ACCESS_AUD: AUD,
  });
  assertEquals(parsed.enabled, true);
  if (!parsed.enabled) throw new Error("expected enabled config");
  assertEquals(parsed.team, TEAM);
  assertEquals(parsed.aud, AUD);
  assertEquals(parsed.issuer, ISSUER);
  assertEquals(parsed.jwksUrl, "https://example.cloudflareaccess.com/cdn-cgi/access/certs");
});

Deno.test("valid RS256 JWT with matching aud/iss/exp returns the normalized email", async () => {
  const keys = await generateRs256();
  const token = await mintJwt(
    keys.privateKey,
    { alg: "RS256", kid: keys.kid, typ: "JWT" },
    claims(),
  );
  const verified = await verifyCfAccessJwt(token, config(), {
    fetchJwks: () => Promise.resolve(keys.jwks),
  });
  assertEquals(verified, { email: "reader@example.invalid" });
});

Deno.test("forged signature, expired token, and aud mismatch all return null", async () => {
  const keys = await generateRs256();
  const other = await generateRs256();
  const header = { alg: "RS256", kid: keys.kid, typ: "JWT" };
  const forged = await mintJwt(other.privateKey, header, claims());
  const expired = await mintJwt(keys.privateKey, header, claims({ exp: 1 }));
  const wrongAud = await mintJwt(keys.privateKey, header, claims({ aud: "other-app" }));
  const deps = { fetchJwks: () => Promise.resolve(keys.jwks) };
  const cfg = config();
  assertEquals(await verifyCfAccessJwt(forged, cfg, deps), null);
  assertEquals(await verifyCfAccessJwt(expired, cfg, deps), null);
  assertEquals(await verifyCfAccessJwt(wrongAud, cfg, deps), null);
});

Deno.test("alg none, missing email, wrong iss, and JWKS fetch failure return null", async () => {
  const keys = await generateRs256();
  const header = { alg: "RS256", kid: keys.kid, typ: "JWT" };
  const none = `${b64url(JSON.stringify({ alg: "none", kid: keys.kid }))}.${
    b64url(JSON.stringify(claims()))
  }.`;
  const noEmail = await mintJwt(keys.privateKey, header, claims({ email: undefined }));
  const wrongIss = await mintJwt(
    keys.privateKey,
    header,
    claims({ iss: "https://other.cloudflareaccess.com" }),
  );
  const deps = { fetchJwks: () => Promise.resolve(keys.jwks) };
  const cfg = config();
  assertEquals(await verifyCfAccessJwt(none, cfg, deps), null);
  assertEquals(await verifyCfAccessJwt(noEmail, cfg, deps), null);
  assertEquals(await verifyCfAccessJwt(wrongIss, cfg, deps), null);
  assertEquals(
    await verifyCfAccessJwt(
      await mintJwt(keys.privateKey, header, claims()),
      cfg,
      { fetchJwks: () => Promise.reject(new Error("jwks unreachable")) },
    ),
    null,
  );
});

Deno.test("JWKS URL override is accepted only for loopback http or the team certs URL", () => {
  const loopback = parseCfAccessEnv({
    PORTICO_CF_ACCESS_ENABLED: "yes",
    PORTICO_CF_ACCESS_TEAM: TEAM,
    PORTICO_CF_ACCESS_AUD: AUD,
    PORTICO_CF_ACCESS_JWKS_URL: "http://127.0.0.1:8799/certs",
  });
  assert(loopback.enabled);
  if (loopback.enabled) {
    assertEquals(loopback.jwksUrl, "http://127.0.0.1:8799/certs");
  }

  const rejected = parseCfAccessEnv({
    PORTICO_CF_ACCESS_ENABLED: "true",
    PORTICO_CF_ACCESS_TEAM: TEAM,
    PORTICO_CF_ACCESS_AUD: AUD,
    PORTICO_CF_ACCESS_JWKS_URL: "http://example.invalid/certs",
  });
  assertEquals(rejected.enabled, false);
});
