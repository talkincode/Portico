import type { Jwks } from "../src/access/mod.ts";

export interface TestRs256 {
  kid: string;
  privateKey: CryptoKey;
  jwks: Jwks;
}

export async function generateRs256(kid = "test-kid"): Promise<TestRs256> {
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

export function b64url(data: Uint8Array | string): string {
  const bytes = typeof data === "string" ? new TextEncoder().encode(data) : data;
  let bin = "";
  for (const byte of bytes) bin += String.fromCharCode(byte);
  return btoa(bin).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

export async function mintJwt(
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
