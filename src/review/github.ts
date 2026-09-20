/**
 * GitHub OAuth login for the Review browser surface (mira pattern).
 *
 * Cloudflare stays a dumb tunnel here: no Access app, no dashboard. Login
 * is an in-app OAuth exchange against github.com, gated by an allowlist of
 * GitHub logins/emails (empty means deny-all, same as mira). A verified,
 * allowlisted email maps onto a roster human via
 * `AccessService.lookupHumanByEmail`; the roster — not GitHub — decides the
 * role, so GitHub can never grant auditor by itself.
 */

export interface GithubUserInfo {
  login: string;
  email?: string;
  emails: string[];
}

export interface GithubOauthConfig {
  enabled: true;
  clientId: string;
  clientSecret: string;
  callbackUrl: string;
  allowlist: string[];
}

export type GithubOauthSettings = { enabled: false } | GithubOauthConfig;

export interface ExchangeGithubCode {
  (config: GithubOauthConfig, code: string): Promise<GithubUserInfo>;
}

export function parseGithubEnv(
  env: Record<string, string | undefined>,
): GithubOauthSettings {
  const flag = (env.PORTICO_REVIEW_GITHUB_ENABLED ?? "").trim().toLowerCase();
  if (!["1", "true", "yes", "on"].includes(flag)) return { enabled: false };
  const clientId = (env.PORTICO_REVIEW_GITHUB_CLIENT_ID ?? "").trim();
  const clientSecret = (env.PORTICO_REVIEW_GITHUB_CLIENT_SECRET ?? "").trim();
  const callbackUrl = (env.PORTICO_REVIEW_GITHUB_CALLBACK ?? "").trim();
  if (!clientId || !clientSecret || !callbackUrl) return { enabled: false };
  try {
    const parsed = new URL(callbackUrl);
    if (parsed.protocol !== "https:" || !parsed.hostname) return { enabled: false };
  } catch {
    return { enabled: false };
  }
  return { enabled: true, clientId, clientSecret, callbackUrl, allowlist: parseAllowlist(env.PORTICO_REVIEW_ALLOWLIST) };
}

export function parseAllowlist(raw: string | undefined): string[] {
  if (!raw) return [];
  const results = new Set<string>();
  for (const part of raw.split(/[\n,;]+/)) {
    const trimmed = part.trim().toLowerCase();
    if (trimmed) results.add(trimmed);
  }
  return [...results];
}

/** Empty allowlist denies everyone; login or any verified email may match. */
export function isAllowedGithubUser(user: GithubUserInfo, allowlist: string[]): boolean {
  if (allowlist.length === 0) return false;
  const candidates = [user.login, user.email, ...user.emails];
  return candidates.some((candidate) =>
    typeof candidate === "string" && allowlist.includes(candidate.trim().toLowerCase())
  );
}

export function githubAuthorizeUrl(config: GithubOauthConfig, state: string): string {
  const url = new URL("https://github.com/login/oauth/authorize");
  url.searchParams.set("client_id", config.clientId);
  url.searchParams.set("redirect_uri", config.callbackUrl);
  url.searchParams.set("scope", "read:user user:email");
  url.searchParams.set("state", state);
  return url.toString();
}

export async function exchangeGithubCode(
  config: GithubOauthConfig,
  code: string,
): Promise<GithubUserInfo> {
  const tokenRes = await fetch("https://github.com/login/oauth/access_token", {
    method: "POST",
    headers: { accept: "application/json", "content-type": "application/json" },
    body: JSON.stringify({
      client_id: config.clientId,
      client_secret: config.clientSecret,
      code,
      redirect_uri: config.callbackUrl,
    }),
  });
  const tokenBody = (await tokenRes.json()) as { access_token?: string };
  if (!tokenBody.access_token) throw new Error("github token exchange failed");
  const headers = {
    accept: "application/vnd.github+json",
    authorization: `token ${tokenBody.access_token}`,
  };
  const userRes = await fetch("https://api.github.com/user", { headers });
  const user = (await userRes.json()) as { login?: string; email?: string };
  if (!user.login) throw new Error("github user lookup failed");
  let emails: string[] = [];
  try {
    const emailsRes = await fetch("https://api.github.com/user/emails", { headers });
    if (emailsRes.ok) {
      const list = (await emailsRes.json()) as Array<{ email?: string; verified?: boolean }>;
      emails = list
        .filter((item) => item.email && item.verified !== false)
        .map((item) => item.email!.toLowerCase());
    }
  } catch {
    // Email list is best-effort; the primary email still counts.
  }
  if (user.email && !emails.includes(user.email.toLowerCase())) {
    emails.push(user.email.toLowerCase());
  }
  return { login: user.login, email: user.email ?? emails[0], emails };
}
