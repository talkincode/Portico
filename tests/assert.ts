export function assertEquals(
  actual: unknown,
  expected: unknown,
  msg?: string,
): void {
  const as = JSON.stringify(actual);
  const es = JSON.stringify(expected);
  if (as !== es) {
    throw new Error(
      msg ?? `assertEquals failed:\n  expected: ${es}\n  actual:   ${as}`,
    );
  }
}

export function assert(cond: unknown, msg = "assert failed"): void {
  if (!cond) throw new Error(msg);
}

export async function assertRejectsCode(
  fn: () => Promise<unknown>,
  code: string,
): Promise<Error> {
  try {
    await fn();
  } catch (error) {
    const err = error as { code?: string; message?: string };
    if (err?.code === code) return error as Error;
    throw new Error(
      `expected CatalogError code ${code}, got ${err?.code ?? err?.message ?? String(error)}`,
    );
  }
  throw new Error(`expected CatalogError code ${code}, but the call resolved`);
}
