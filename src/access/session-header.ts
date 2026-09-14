import { CatalogError, ErrorCode } from "../catalog/errors.ts";

/**
 * Session-token extraction, shared by every entrance that accepts a login
 * session over HTTP (Portal, Gateway, MCP).
 *
 * This used to be copy-pasted per entrance; a third copy would have been the
 * point where the three entrances start disagreeing about how a caller proves
 * who they are, which is precisely the class of drift that produced the
 * current identity hole. There is exactly one implementation now.
 *
 * Deliberately absent: any `X-Portico-Actor-*` claim path. A network caller
 * must present a session token; asserting an identity in a header is not
 * proof of it.
 */
export function readSessionToken(request: Request): string | null {
  const named = request.headers.get("x-portico-session");
  const auth = request.headers.get("authorization");
  let bearer: string | null = null;
  if (auth) {
    const match = /^Bearer\s+(\S+)$/i.exec(auth.trim());
    if (!match) {
      throw new CatalogError(ErrorCode.INVALID_INPUT, "authorization must be a Bearer token");
    }
    bearer = match[1];
  }
  if (named && bearer && named !== bearer) {
    throw new CatalogError(ErrorCode.FORBIDDEN, "session headers do not match");
  }
  return named ?? bearer;
}
