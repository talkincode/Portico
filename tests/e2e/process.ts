/**
 * Helpers for testing the entrypoints as real processes.
 *
 * Importing `listenPortal` / `listenGateway` and calling them directly tests
 * routing logic but never tests the thing an operator runs. These helpers
 * spawn the actual entrypoint, wait for its single machine-readable startup
 * line, and shut it down again — including its children, which is how the
 * `up` supervisor gets exercised.
 */

export interface JsonBody<T = unknown> {
  ok: boolean;
  data?: T;
  error?: { code: string; message: string };
}

export interface Announced<T> {
  body: JsonBody<T> & { data: T };
  stop: () => Promise<void>;
}

function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) => setTimeout(() => reject(new Error(message)), ms)),
  ]);
}

async function firstJsonLine(
  reader: ReadableStreamDefaultReader<Uint8Array>,
): Promise<{ body: JsonBody; leftover: string }> {
  const decoder = new TextDecoder();
  let buffer = "";
  while (true) {
    const index = buffer.indexOf("\n");
    if (index >= 0) {
      const line = buffer.slice(0, index).trim();
      const leftover = buffer.slice(index + 1);
      if (line) return { body: JSON.parse(line) as JsonBody, leftover };
      buffer = leftover;
      continue;
    }
    const chunk = await withTimeout(
      reader.read(),
      20_000,
      `entrypoint produced no startup line; output so far: ${buffer}`,
    );
    if (chunk.done) {
      throw new Error(`entrypoint exited before announcing its state; output: ${buffer}`);
    }
    buffer += decoder.decode(chunk.value, { stream: true });
  }
}

export async function bootEntrypoint<T>(
  entry: string,
  env: Record<string, string>,
  perms: readonly string[],
): Promise<Announced<T>> {
  const child = new Deno.Command(Deno.execPath(), {
    args: ["run", ...perms, entry],
    env: {
      ...Deno.env.toObject(),
      PORTICO_BIND: "127.0.0.1",
      // Port 0 lets the OS pick, so parallel tests never collide.
      PORTICO_PORT: "0",
      ...env,
    },
    stdout: "piped",
    stderr: "piped",
  }).spawn();

  const reader = child.stdout.getReader();

  const stop = async (): Promise<void> => {
    try {
      await reader.cancel();
    } catch {
      // The stream is already closed when the child died on its own.
    }
    try {
      child.kill("SIGTERM");
    } catch {
      // Already gone.
    }
    const force = setTimeout(() => {
      try {
        child.kill("SIGKILL");
      } catch {
        // Already gone.
      }
    }, 3_000);
    await child.status;
    clearTimeout(force);
    try {
      await child.stderr.cancel();
    } catch {
      // Already read or closed.
    }
  };

  try {
    const { body, leftover } = await firstJsonLine(reader);
    if (!body.ok) {
      throw new Error(`entrypoint refused to start: ${JSON.stringify(body)}`);
    }
    // Keep draining so a chatty child never blocks on a full pipe buffer.
    void (async () => {
      const decoder = new TextDecoder();
      if (leftover.trim()) console.error(`[test] ${leftover.trimEnd()}`);
      try {
        while (true) {
          const chunk = await reader.read();
          if (chunk.done) break;
          const text = decoder.decode(chunk.value, { stream: true });
          if (text.trim()) console.error(`[test] ${text.trimEnd()}`);
        }
      } catch {
        // Closed with the child.
      }
    })();
    return { body: body as JsonBody<T> & { data: T }, stop };
  } catch (error) {
    const detail = await new Response(child.stderr).text();
    await stop();
    throw new Error(`${(error as Error).message}\n[stderr] ${detail}`, { cause: error });
  }
}
