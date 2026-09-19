export const ErrorCode = {
  INVALID_INPUT: "INVALID_INPUT",
  FORBIDDEN: "FORBIDDEN",
  PUBLIC_REQUIRES_APPROVAL: "PUBLIC_REQUIRES_APPROVAL",
  ALREADY_EXISTS: "ALREADY_EXISTS",
  NOT_FOUND: "NOT_FOUND",
  INVALID_STATE: "INVALID_STATE",
  SELF_APPROVAL: "SELF_APPROVAL",
  SELF_AUDIT: "SELF_AUDIT",
  USAGE: "USAGE",
} as const;

export type ErrorCode = (typeof ErrorCode)[keyof typeof ErrorCode];

export class CatalogError extends Error {
  readonly code: ErrorCode;

  constructor(code: ErrorCode, message: string) {
    super(message);
    this.name = "CatalogError";
    this.code = code;
  }
}
