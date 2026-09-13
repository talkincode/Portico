import {
  type Actor,
  type ActorKind,
  type ActorRole,
  type ApprovalDecisionInput,
  CatalogError,
  CatalogService,
  ErrorCode,
  FileCatalogStore,
  type PublishInput,
  type RegisterInput,
} from "../catalog/mod.ts";

const USAGE = `portico <command>

Commands:
  catalog register  --catalog <path> --actor-id <id> --actor-kind <human|agent> --actor-role <role> --input <file>
  catalog draft     --catalog <path> --actor-id <id> --actor-kind <human|agent> --actor-role <role> --input <file>
  catalog publish   --id <id> --visibility <internal|public> --catalog <path> --actor-id <id> --actor-kind <human|agent> --actor-role <role>
  catalog approve   --id <id> --catalog <path> --actor-id <id> --actor-kind <human|agent> --actor-role <role>
  catalog reject    --id <id> --catalog <path> --actor-id <id> --actor-kind <human|agent> --actor-role <role>
  catalog approvals --catalog <path> --actor-id <id> --actor-kind <human|agent> --actor-role <role>
  catalog list      --catalog <path> --actor-id <id> --actor-kind <human|agent> --actor-role <role>
  catalog get       --id <id> --catalog <path> --actor-id <id> --actor-kind <human|agent> --actor-role <role>

Catalog path may also be set with PORTICO_CATALOG_PATH.
Actor identity is a trusted CLI flag until Access Control lands.
The identity that submitted public cannot approve or reject the same request.
Output is always JSON.`;

interface CliResult {
  exitCode: number;
  stdout: string;
}

class UsageError extends Error {
  readonly code = ErrorCode.USAGE;
  constructor(message: string) {
    super(message);
    this.name = "UsageError";
  }
}

export async function runCli(
  args: string[],
  env: Record<string, string | undefined> = Deno.env.toObject(),
): Promise<CliResult> {
  try {
    const { positionals, flags } = parseArgs(args);
    if (flags.help === "true" || positionals.length === 0) {
      return ok({ usage: USAGE });
    }

    const [group, action] = positionals;
    if (group !== "catalog") {
      throw new UsageError(`unknown command '${group}'`);
    }

    const actor = readActor(flags);
    const catalogPath = flags.catalog ?? env.PORTICO_CATALOG_PATH;
    if (!catalogPath) {
      throw new UsageError("missing --catalog or PORTICO_CATALOG_PATH");
    }

    const service = new CatalogService(new FileCatalogStore(catalogPath));

    if (action === "register" || action === "draft") {
      if (!flags.input) throw new UsageError("missing --input");
      const raw = await Deno.readTextFile(flags.input);
      let payload: unknown;
      try {
        payload = JSON.parse(raw);
      } catch {
        throw new CatalogError(ErrorCode.INVALID_INPUT, "input file is not valid JSON");
      }
      const record = action === "draft"
        ? await service.draft(actor, payload as RegisterInput)
        : await service.register(actor, payload as RegisterInput);
      return ok(record);
    }

    if (action === "publish") {
      if (!flags.id) throw new UsageError("missing --id");
      if (!flags.visibility) throw new UsageError("missing --visibility");
      const payload: PublishInput = {
        id: flags.id,
        visibility: flags.visibility as PublishInput["visibility"],
      };
      return ok(await service.publish(actor, payload));
    }

    if (action === "approve" || action === "reject") {
      if (!flags.id) throw new UsageError("missing --id");
      const payload: ApprovalDecisionInput = { id: flags.id };
      return ok(
        action === "approve"
          ? await service.approve(actor, payload)
          : await service.reject(actor, payload),
      );
    }

    if (action === "approvals") {
      return ok(await service.listApprovals(actor));
    }

    if (action === "list") {
      return ok(await service.list(actor));
    }

    if (action === "get") {
      if (!flags.id) throw new UsageError("missing --id");
      return ok(await service.get(actor, flags.id));
    }

    throw new UsageError(action ? `unknown catalog action '${action}'` : "missing catalog action");
  } catch (error) {
    return fail(error);
  }
}

function parseArgs(args: string[]): {
  positionals: string[];
  flags: Record<string, string>;
} {
  const positionals: string[] = [];
  const flags: Record<string, string> = {};
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--help" || arg === "-h") {
      flags.help = "true";
      continue;
    }
    if (arg.startsWith("--")) {
      const key = arg.slice(2);
      const value = args[i + 1];
      if (!value || value.startsWith("-")) {
        throw new UsageError(`flag --${key} requires a value`);
      }
      flags[key] = value;
      i += 1;
      continue;
    }
    positionals.push(arg);
  }
  return { positionals, flags };
}

function readActor(flags: Record<string, string>): Actor {
  const id = flags["actor-id"];
  const kind = flags["actor-kind"] as ActorKind | undefined;
  const role = flags["actor-role"] as ActorRole | undefined;
  if (!id || !kind || !role) {
    throw new UsageError("missing --actor-id, --actor-kind, or --actor-role");
  }
  return { id, kind, role };
}

function ok(data: unknown): CliResult {
  return { exitCode: 0, stdout: JSON.stringify({ ok: true, data }) };
}

function fail(error: unknown): CliResult {
  if (error instanceof CatalogError || error instanceof UsageError) {
    return {
      exitCode: 1,
      stdout: JSON.stringify({
        ok: false,
        error: { code: error.code, message: error.message },
      }),
    };
  }
  const message = error instanceof Error ? error.message : String(error);
  return {
    exitCode: 1,
    stdout: JSON.stringify({
      ok: false,
      error: { code: "INTERNAL", message },
    }),
  };
}

if (import.meta.main) {
  const result = await runCli(Deno.args);
  console.log(result.stdout);
  Deno.exit(result.exitCode);
}
